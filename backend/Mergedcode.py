#!/usr/bin/env python3
"""
AS228T PLC + NeoPixel + WebSocket Bridge
Pi CM5 -> PLC 192.168.1.5:502
- Cut lengths written to D404-D405 (Target Position DWORD)
- D300-D301 (signed int32 DWORD) → Servo absolute position; > 0 → CUTTING status
- D200.0 (single bit) == 1 → HOMING; 1→0 transition → HOME
- D100.6 == 1 → ACK (cycle complete) — PLC clears it internally
- D500.1 → positive end limit | D500.2 → negative end limit (NeoPixels RED)
- D100.4 → Vacuum on
- WebSocket server on ws://localhost:8765
"""

import asyncio
import csv
import json
import os
import struct
import threading
import spidev
import time
import RPi.GPIO as GPIO

from aiohttp import web
import aiohttp
from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusException

INVENTORY_FILE = os.path.expanduser("~/inventory_profiles.csv")

# ─── PLC CONFIG ───────────────────────────────
PLC_IP            = '192.168.1.5'
PLC_PORT          = 502
POLL_INTERVAL_SEC = 1.0

# ─── TOWER LIGHT GPIO SETUP ───────────────────
TOWER_LIGHT_PIN = 17
GPIO.setmode(GPIO.BCM)

# ─── NEOPIXEL SPI SETUP ───────────────────────
NUM_LEDS   = 150
BRIGHTNESS = 0.5

spi = spidev.SpiDev()
spi.open(0, 0)
spi.max_speed_hz = 6400000
spi.mode = 0

def _encode_byte(byte):
    out = []
    for i in range(7, -1, -1):
        out += [0b11111000 if byte & (1 << i) else 0b11000000]
    return out


def _encode_color(r, g, b):
    """WS2812B expects GRB order."""
    r = int(r * BRIGHTNESS)
    g = int(g * BRIGHTNESS)
    b = int(b * BRIGHTNESS)
    return _encode_byte(g) + _encode_byte(r) + _encode_byte(b)

def show(pixels):
    """Send all pixel data over SPI in chunks to avoid 4096 byte limit."""
    data = []
    for (r, g, b) in pixels:
        data += _encode_color(r, g, b)
    data += [0] * 50
    chunk_size = 4096
    for i in range(0, len(data), chunk_size):
        spi.xfer2(data[i:i + chunk_size])

def fill_all(color):
    """Fill all LEDs with a single color instantly."""
    show([color] * NUM_LEDS)

# ─── MODBUS CLIENT + THREAD LOCK ──────────────
modbus_client = ModbusTcpClient(PLC_IP, port=PLC_PORT, timeout=2, retries=3)
_modbus_lock  = threading.Lock()   # one Modbus operation at a time

def connect_plc():
    with _modbus_lock:
        if modbus_client.connect():
            print(f"✅ Connected to AS228T PLC at {PLC_IP}:{PLC_PORT}")
            return True
    print("❌ PLC Connection Failed!")
    return False

# ─── Sync helpers (called via run_in_executor) ─
def read_word(reg):
    with _modbus_lock:
        try:
            r = modbus_client.read_holding_registers(reg, count=1)
            return None if r.isError() else r.registers[0]
        except Exception:
            return None

def read_dword_float(reg):
    with _modbus_lock:
        try:
            r = modbus_client.read_holding_registers(reg, count=2)
            if r.isError():
                return None
            raw = (r.registers[1] << 16) | r.registers[0]
            return struct.unpack('>f', raw.to_bytes(4, 'big'))[0]
        except Exception:
            return None

def read_dword_int(reg):
    """Signed 32-bit DWORD read (low word at reg, high word at reg+1)."""
    with _modbus_lock:
        try:
            r = modbus_client.read_holding_registers(reg, count=2)
            if r.isError():
                return None
            raw = (r.registers[1] << 16) | r.registers[0]
            return raw - 0x100000000 if raw & 0x80000000 else raw
        except Exception:
            return None

def write_word(reg, value, desc=""):
    with _modbus_lock:
        try:
            r = modbus_client.write_register(reg, value)
            ok = not r.isError()
            print(f"  {'✅' if ok else '❌'} D{reg:04d} = {value}  {desc}")
            return ok
        except ModbusException as e:
            print(f"  ❌ D{reg}: {e}")
            return False

def write_dword(reg, value_32, desc=""):
    low  =  value_32        & 0xFFFF
    high = (value_32 >> 16) & 0xFFFF
    with _modbus_lock:
        try:
            r_lo = modbus_client.write_register(reg,     low)
            r_hi = modbus_client.write_register(reg + 1, high)
            ok = not r_lo.isError() and not r_hi.isError()
            print(f"  {'✅' if ok else '❌'} D{reg:04d}-D{reg+1:04d} = {value_32}  {desc}")
            return ok
        except ModbusException as e:
            print(f"  ❌ DWORD D{reg}: {e}")
            return False

def read_bit(reg, bit):
    with _modbus_lock:
        try:
            r = modbus_client.read_holding_registers(reg, count=1)
            return None if r.isError() else bool(r.registers[0] & (1 << bit))
        except Exception:
            return None

def write_bit(reg, bit, value, desc=""):
    with _modbus_lock:
        try:
            r = modbus_client.read_holding_registers(reg, count=1)
            if r.isError():
                print(f"  ❌ D{reg}.{bit} RMW read failed")
                return False
            current = r.registers[0]
            new_val = (current | (1 << bit)) if value else (current & ~(1 << bit))
            w = modbus_client.write_register(reg, new_val & 0xFFFF)
            ok = not w.isError()
            print(f"  {'✅' if ok else '❌'} D{reg}.{bit} = {int(bool(value))}  {desc}")
            return ok
        except ModbusException as e:
            print(f"  ❌ D{reg}.{bit}: {e}")
            return False

# ─── Async wrappers (run sync helpers in thread pool) ─
async def _run(fn, *args):
    return await asyncio.get_event_loop().run_in_executor(None, fn, *args)

async def async_read_word(reg):       return await _run(read_word, reg)
async def async_read_dword_float(reg): return await _run(read_dword_float, reg)
async def async_read_dword_int(reg):   return await _run(read_dword_int, reg)
async def async_write_word(reg, v, d=""): return await _run(write_word, reg, v, d)
async def async_write_dword(reg, v, d=""): return await _run(write_dword, reg, v, d)
async def async_read_bit(reg, bit):       return await _run(read_bit, reg, bit)
async def async_write_bit(reg, bit, v, d=""): return await _run(write_bit, reg, bit, v, d)

# ─── WEBSOCKET STATE ──────────────────────────
ws_clients            = set()
sequence_task         = None
stop_event            = asyncio.Event()
current_machine_status = "home"          # last known status — sent to new clients on connect
last_plc_regs         = {"d300": None}
PRINTER_DEVICE        = "/dev/usb/lp0"   # Brother QL-800 USB
printer_connected     = False
active_alerts         = {}               # key → {message, severity}

async def broadcast(msg):
    data = json.dumps(msg)
    for ws in list(ws_clients):
        try:
            await ws.send_str(data)
        except Exception:
            pass

# ─── NEOPIXEL POLL TASK ───────────────────────
async def neopixel_poll_loop():
    """
    Continuously poll D500 error register.
    Any of bits 0-14 set → RED (servo/encoder error or end limit)
    cutting status → ORANGE | else → GREEN
    """
    last_color = None
    while True:
        d500 = await async_read_word(500)
        if d500 is not None:
            error_bits_mask = 0x7FFF  # bits 0..14
            limit_hit = bool(d500 & error_bits_mask)
            if limit_hit:
                color = (255, 0, 0)       # RED
                tower_on = True
            elif current_machine_status == "cutting":
                color = (255, 127, 0)     # ORANGE
                tower_on = True
            else:
                color = (0, 255, 0)       # GREEN
                tower_on = False
            if color != last_color:
                fill_all(color)
                last_color = color
        await asyncio.sleep(POLL_INTERVAL_SEC)
# ─── CUTTING / STATUS POLL (always running) ──────────
async def status_poll_loop():
    """
    Single source of truth for ALL machine status.
    Priority (most active first):
      D302-D303 > 0  OR  D100.7 == 1 → CUTTING
      D100.8 == 1                    → RETRACTED
      D200.0 == 1                    → HOMING   (RESET pressed)
      D100.1 == 1  AND  D300 == 0    → HOME     (homing complete + at zero)
      D100.0 == 1                    → READY    (servo initialized)
    Also broadcasts plc_registers (D300 position) on value change.
    """
    global current_machine_status, last_plc_regs
    last_status   = None
    prev_d300     = None

    while True:
        d300_val = await async_read_dword_int(300)
        d302_val = await async_read_dword_int(302)
        d100_0   = await async_read_bit(100, 0)
        d100_1   = await async_read_bit(100, 1)
        d100_7   = await async_read_bit(100, 7)
        d100_8   = await async_read_bit(100, 8)
        d200_0   = await async_read_bit(200, 0)

        if (d302_val is not None and d302_val > 0) or d100_7 is True:
            status = "cutting"
        elif d100_8 is True:
            status = "retracted"
        elif d200_0 is True:
            status = "homing"
        elif d100_1 is True and d300_val == 0:
            status = "home"
        elif d100_0 is True:
            status = "ready"
        else:
            status = None          # no signal — keep last known status

        if status is not None and status != last_status:
            last_status = status
            current_machine_status = status
            await broadcast({"type": "machine_status", "status": status})
            if status == "cutting":
                await broadcast({"type": "log", "message": f"✂️ Cutting — D302={d302_val} / D100.7={int(bool(d100_7))}"})
            elif status == "retracted":
                await broadcast({"type": "log", "message": "↩ Retracted — D100.8=1"})
            elif status == "homing":
                await broadcast({"type": "log", "message": "🏠 Homing — D200.0=1"})
            elif status == "home":
                await broadcast({"type": "log", "message": "✅ Home — D100.1=1 & D300=0"})
            elif status == "ready":
                await broadcast({"type": "log", "message": "🟢 Ready — D100.0=1"})

        # ── register tile (D300 position) ──
        if d300_val != prev_d300:
            prev_d300 = d300_val
            last_plc_regs = {"d300": d300_val}
            await broadcast({"type": "plc_registers", **last_plc_regs})

        await asyncio.sleep(0.1)

# ─── D100.6 ACK POLL (during sequence only) ──────────────────
async def wait_for_cutting_and_ack():
    """
    Wait for D100.6 rising edge (cycle complete ACK from PLC).
    Waits for a falling edge first to avoid catching a stale =1 from the prior cut.
    PLC clears D100.6 internally — we never write to it.
    Returns True on ACK, False if stopped or persistent errors.
    """
    error_count = 0
    saw_low = False

    while not stop_event.is_set():
        bit = await async_read_bit(100, 6)

        if bit is None:
            error_count += 1
            if error_count >= 10:
                await broadcast({"type": "log", "message": "⚠️ D100.6 persistent read errors — aborting"})
                return False
            await asyncio.sleep(0.2)
            continue
        error_count = 0

        if not saw_low:
            if bit is False:
                saw_low = True
        elif bit is True:
            await broadcast({"type": "log", "message": "✔ ACK received (D100.6 == 1)"})
            return True

        await asyncio.sleep(0.2)
    return False

# ─── BROTHER QL-800 LABEL PRINT ───────────────
PRINT_LABEL_SCRIPT = os.path.expanduser("~/print_label.py")
_print_lock = None  # initialised on first use (needs running event loop)

async def _print_ql800(cut, position):
    global _print_lock
    if _print_lock is None:
        _print_lock = asyncio.Lock()

    data = {
        "pieceLabel":  cut.get("label",    f"Cut {position}"),
        "barLabel":    cut.get("barLabel", ""),
        "profile":     cut.get("profile",  ""),
        "length":      cut.get("length",   ""),
        "desc":        cut.get("desc",     ""),
        "zone":        "",
        "cutPosition": position,
    }
    async with _print_lock:   # only one print_label.py can run at a time
        try:
            proc = await asyncio.create_subprocess_exec(
                "/usr/bin/python3", PRINT_LABEL_SCRIPT, json.dumps(data),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                print(f"[PRINT] failed: {stderr.decode().strip()}")
            else:
                print(f"[PRINT] ✓ {data['pieceLabel']}")
        except Exception as e:
            print(f"[PRINT] error: {e}")

# ─── SEQUENCE LOGIC ───────────────────────────
async def run_sequence(ws, cuts):
    global sequence_task
    total = len(cuts)

    # ── Pre-step: enable absolute mode (D200.1 = 1) ──
    if not await async_write_bit(200, 1, True, "Enable absolute mode (sequence start)"):
        await ws.send_str(json.dumps({"type": "log", "message": "❌ Failed to write D200.1 — sequence aborted"}))
        await ws.send_str(json.dumps({"type": "sequence_stopped"}))
        sequence_task = None
        return
    await broadcast({"type": "log", "message": "✔ D200.1 = 1 — absolute mode enabled"})

    for i, cut in enumerate(cuts):
        if stop_event.is_set():
            await ws.send_str(json.dumps({"type": "sequence_stopped"}))
            await ws.send_str(json.dumps({"type": "log", "message": "■ Sequence stopped"}))
            sequence_task = None
            return

        length = int(round(-cut["length"] * 100))
        label  = cut.get("label", f"Cut {i + 1}")

        # ── Step 1: Write length to D404-D405 ──
        await broadcast({"type": "log", "message": f"▶ [{i+1}/{total}] {label} → Sending {length} mm to D404-D405"})
        success = await async_write_dword(404, length, f"Cut {i+1}/{total} - {label}")
        if not success:
            await ws.send_str(json.dumps({"type": "log", "message": f"❌ Failed to write length {length} to PLC"}))
            await ws.send_str(json.dumps({"type": "sequence_stopped"}))
            sequence_task = None
            return

        # ── Step 2: Wait for D100.6 == 1 (cycle complete ACK) ──
        # D300 > 0 → CUTTING, D100.6 == 1 → cycle done (PLC clears it internally)
        await broadcast({"type": "log", "message": "⏳ Monitoring D300 (cutting) and D100.6 (ACK)..."})
        acked = await wait_for_cutting_and_ack()
        if not acked:
            await ws.send_str(json.dumps({"type": "sequence_stopped"}))
            await ws.send_str(json.dumps({"type": "log", "message": "■ Sequence stopped (no ACK from D100.6)"}))
            sequence_task = None
            return

        # ── Print label for this cut on Brother QL-800, then report progress ──
        asyncio.create_task(_print_ql800(cut, i + 1))
        await ws.send_str(json.dumps({"type": "log", "message": f"[PRINT] → {label}"}))
        await ws.send_str(json.dumps({"type": "sequence_progress", "idx": i, "total": total}))

    # ── All cuts done ──
    await ws.send_str(json.dumps({"type": "sequence_done", "total": total}))
    await ws.send_str(json.dumps({"type": "log", "message": f"✅ Sequence complete — {total} cuts sent"}))
    print(f"Sequence complete: {total} cuts sent")
    sequence_task = None

# ─── WEBSOCKET HANDLER ────────────────────────
async def ws_handler(request):
    global sequence_task
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    ws_clients.add(ws)
    print("Frontend connected")

    # Send current state snapshot to newly connected client
    connected = modbus_client.connected
    await ws.send_str(json.dumps({
        "type":      "status",
        "connected": connected,
        "message":   f"✔ Connected to PLC {PLC_IP}:{PLC_PORT}" if connected
                     else f"⚠️ PLC not connected"
    }))
    await ws.send_str(json.dumps({"type": "machine_status", "status": current_machine_status}))
    await ws.send_str(json.dumps({"type": "plc_registers",  **last_plc_regs}))
    await ws.send_str(json.dumps({"type": "printer_status", "connected": printer_connected}))
    for key, alert in active_alerts.items():
        await ws.send_str(json.dumps({
            "type":     "alert",
            "key":      key,
            "active":   True,
            "severity": alert["severity"],
            "message":  alert["message"],
        }))

    async for msg in ws:
        if msg.type == aiohttp.WSMsgType.TEXT:
            try:
                cmd = json.loads(msg.data)
            except json.JSONDecodeError:
                await ws.send_str(json.dumps({"type": "log", "message": "⚠ Invalid JSON"}))
                continue

            action = cmd.get("cmd")

            if action == "start_sequence":
                cuts = cmd.get("cuts", [])
                if not cuts:
                    await ws.send_str(json.dumps({"type": "log", "message": "⚠ No cuts found — run optimizer first"}))
                    continue
                if not modbus_client.connected:
                    await ws.send_str(json.dumps({"type": "log",             "message": "❌ PLC not connected — sequence aborted"}))
                    await ws.send_str(json.dumps({"type": "sequence_stopped"}))
                    continue
                stop_event.clear()
                if sequence_task and not sequence_task.done():
                    sequence_task.cancel()
                sequence_task = asyncio.create_task(run_sequence(ws, cuts))

            elif action == "stop_sequence":
                stop_event.set()
                await ws.send_str(json.dumps({"type": "log", "message": "■ Stopping..."}))

            elif action == "home":
                # RESET button pressed — stop any running sequence, then trigger PLC homing
                stop_event.set()
                success = await async_write_bit(200, 0, True, "Home / Reset")
                if success:
                    await broadcast({"type": "machine_status", "status": "homing"})
                    await ws.send_str(json.dumps({"type": "log", "message": "🏠 D200.0 = 1 sent — PLC homing triggered"}))
                else:
                    await ws.send_str(json.dumps({"type": "log", "message": "❌ Failed to write D200.0 for homing"}))

            elif action == "save_steps":
                steps_per_unit = cmd.get("stepsPerUnit", 0)
                spu = int(round(steps_per_unit))
                ok_spu = await async_write_dword(406, spu & 0xFFFFFFFF, "Steps/unit D406-D407")
                if ok_spu:
                    await ws.send_str(json.dumps({"type": "log", "message": f"⚙ Steps/unit — D406-D407 = {spu}"}))
                else:
                    await ws.send_str(json.dumps({"type": "log", "message": "❌ Failed to write steps/unit to D406-D407"}))

                speed = abs(int(round(steps_per_unit / 2)))
                ok_spd = await async_write_dword(402, speed, "Speed D402-D403")
                if ok_spd:
                    await ws.send_str(json.dumps({"type": "log", "message": f"⚙ Speed — D402-D403 = {speed} (|steps/unit / 2|)"}))
                else:
                    await ws.send_str(json.dumps({"type": "log", "message": "❌ Failed to write speed to D402-D403"}))

            elif action == "error_reset":
                # E-Stop / end-limit reset button — clear error via D200.2, then home via D200.0
                stop_event.set()
                ok_clear = await async_write_bit(200, 2, True, "Error reset (D200.2)")
                ok_home  = await async_write_bit(200, 0, True, "Home / Reset")
                if ok_clear:
                    await ws.send_str(json.dumps({"type": "log", "message": "🧯 D200.2 = 1 sent — error cleared"}))
                else:
                    await ws.send_str(json.dumps({"type": "log", "message": "❌ Failed to write D200.2 for error reset"}))
                if ok_home:
                    await broadcast({"type": "machine_status", "status": "homing"})
                    await ws.send_str(json.dumps({"type": "log", "message": "🏠 D200.0 = 1 sent — homing to safe position"}))
                else:
                    await ws.send_str(json.dumps({"type": "log", "message": "❌ Failed to write D200.0 for homing"}))

            elif action == "set_calibration":
                dist_move        = cmd.get("distMove",        0)
                dist_meas        = cmd.get("distMeas",        0)
                calib_val        = cmd.get("calibValue",      0)   # distMove - distMeas
                steps_per_unit   = cmd.get("stepsPerUnit",    0)
                retract_position = cmd.get("retractPosition", 0)

                # D400-D401: calibration offset (signed DWORD, two's complement)
                reg_val_32 = int(round(calib_val)) & 0xFFFFFFFF
                ok_off = await async_write_dword(400, reg_val_32, "Calibration offset D400-D401")
                if ok_off:
                    await ws.send_str(json.dumps({"type": "log", "message": f"⚙ Calibration saved — D400-D401 = {int(round(calib_val))} mm (move:{dist_move} meas:{dist_meas})"}))
                else:
                    await ws.send_str(json.dumps({"type": "log", "message": "❌ Failed to write calibration to D400-D401"}))

                # D406-D407: steps per unit (signed DWORD)
                spu = int(round(steps_per_unit))
                ok_spu = await async_write_dword(406, spu & 0xFFFFFFFF, "Steps/unit D406-D407")
                if ok_spu:
                    await ws.send_str(json.dumps({"type": "log", "message": f"⚙ Steps/unit — D406-D407 = {spu}"}))
                else:
                    await ws.send_str(json.dumps({"type": "log", "message": "❌ Failed to write steps/unit to D406-D407"}))

                # D402-D403: speed = abs(steps_per_unit / 2)
                speed = abs(int(round(steps_per_unit / 2)))
                ok_spd = await async_write_dword(402, speed, "Speed D402-D403")
                if ok_spd:
                    await ws.send_str(json.dumps({"type": "log", "message": f"⚙ Speed — D402-D403 = {speed} (|steps/unit / 2|)"}))
                else:
                    await ws.send_str(json.dumps({"type": "log", "message": "❌ Failed to write speed to D402-D403"}))

                # D408-D409: retract position (signed DWORD)
                retract = int(round(retract_position*-10))
                ok_ret = await async_write_dword(408, retract & 0xFFFFFFFF, "Retract position D408-D409")
                if ok_ret:
                    await ws.send_str(json.dumps({"type": "log", "message": f"⚙ Retract position — D408-D409 = {retract}"}))
                else:
                    await ws.send_str(json.dumps({"type": "log", "message": "❌ Failed to write retract position to D408-D409"}))

            elif action == "optimize":
                await async_write_bit(200, 0, False, "Clear Sequence Done Flag")
                await ws.send_str(json.dumps({"type": "log", "message": "🔄 Optimize clicked — D200.0 cleared to 0"}))

        elif msg.type == aiohttp.WSMsgType.ERROR:
            print(f"WebSocket error: {ws.exception()}")

    ws_clients.discard(ws)
    if sequence_task and not sequence_task.done():
        sequence_task.cancel()
    print("Frontend disconnected")
    return ws


# ─── BACKGROUND: PLC CONNECTION POLL ─────────
D500_BITS = [
    # (key, bit_index, severity, message)
    ("emergency_alarm",       0,  "warning", "🚨 Emergency alarm"),
    ("end_limit_pos",         1,  "warning", "Positive end limit reached"),
    ("end_limit_neg",         2,  "warning", "Negative end limit reached"),
    ("abs_before_homing",     3,  "warning", "ABS given before homing on power-on"),
    ("servo_over_current",    4,  "warning", "Servo over current"),
    ("servo_over_voltage",    5,  "warning", "Servo over voltage"),
    ("servo_under_voltage",   6,  "warning", "Servo under voltage"),
    ("servo_overload",        7,  "warning", "Servo overload"),
    ("servo_over_speed",      8,  "warning", "Servo over speed"),
    ("encoder_comm_error",    9,  "warning", "Encoder communication error"),
    ("input_phase_loss",      10, "warning", "Input phase loss"),
    ("encoder_alarm1",        11, "warning", "Encoder alarm 1"),
    ("encoder_alarm2",        12, "warning", "Encoder alarm 2"),
    ("encoder_alarm3",        13, "warning", "Encoder alarm 3"),
    ("abs_position_overflow", 14, "warning", "ABS position overflow"),
]

async def alerts_poll_loop():
    """Poll D500 (error register) and D100 bits, broadcast popup alerts on state change.
       D500 bits 0-14 → servo/encoder errors and end limits (see D500_BITS table)
       D100.4 == 1    → Vacuum turned on (info)
    """
    state = {k: None for k, _, _, _ in D500_BITS}
    state["vacuum"] = None

    while True:
        d500 = await async_read_word(500)
        d100 = await async_read_word(100)

        rules = []
        if d500 is not None:
            for key, bit, severity, message in D500_BITS:
                rules.append((key, bool(d500 & (1 << bit)), severity, message))
        if d100 is not None:
            rules.append(("vacuum", bool(d100 & 0x0010), "info", "Vacuum turned on"))

        for key, active, severity, message in rules:
            if active != state[key]:
                state[key] = active
                if active:
                    active_alerts[key] = {"message": message, "severity": severity}
                else:
                    active_alerts.pop(key, None)
                await broadcast({
                    "type":     "alert",
                    "key":      key,
                    "active":   active,
                    "severity": severity,
                    "message":  message,
                })
        await asyncio.sleep(0.5)


async def printer_poll_loop():
    """Every 1s: check if Brother QL-800 USB device exists. Broadcast on change."""
    global printer_connected
    last = None
    while True:
        present = os.path.exists(PRINTER_DEVICE)
        if present != last:
            last = present
            printer_connected = present
            await broadcast({"type": "printer_status", "connected": present})
            print(f"{'🖨️ Printer connected' if present else '🖨️ Printer disconnected'}")
        await asyncio.sleep(1.0)


async def plc_status_poll_loop():
    """
    Every 0.5 s: check PLC connection.
    Uses fail-count debouncing so a transient lock-contention failure
    (e.g. during a calibration write) doesn't flap the UI offline.
    """
    last_connected = None
    fail_count     = 0
    FAIL_THRESHOLD = 4    # ~2s of consecutive failures before declaring disconnect

    while True:
        val = await async_read_word(200)

        if val is not None:
            fail_count          = 0
            currently_connected = True
        else:
            fail_count += 1
            if fail_count >= FAIL_THRESHOLD:
                # Persistent failure — declare disconnect and try to reconnect
                currently_connected = False
                try:
                    await asyncio.get_event_loop().run_in_executor(None, connect_plc)
                    val = await async_read_word(200)
                    if val is not None:
                        currently_connected = True
                        fail_count          = 0
                except Exception:
                    pass
            else:
                # Transient failure — keep last known state
                currently_connected = bool(last_connected)

        # Broadcast only on state change
        if currently_connected != last_connected:
            last_connected = currently_connected
            msg = (f"✔ PLC connected ({PLC_IP}:{PLC_PORT})"
                   if currently_connected
                   else f"⚠️ PLC disconnected ({PLC_IP}:{PLC_PORT})")
            await broadcast({"type": "status", "connected": currently_connected, "message": msg})
            print(f"{'✅' if currently_connected else '❌'} {msg}")

        await asyncio.sleep(0.5)


# ─── INVENTORY CSV ────────────────────────────

CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}

def load_inventory():
    if not os.path.exists(INVENTORY_FILE):
        return []
    items = []
    try:
        with open(INVENTORY_FILE, newline='') as f:
            for row in csv.DictReader(f):
                items.append({
                    'id':      row['id'],
                    'profile': row['profile'],
                    'length':  float(row['length']),
                    'qty':     int(row['qty']),
                })
    except Exception as e:
        print(f"Inventory load error: {e}")
    return items

def save_inventory(items):
    with open(INVENTORY_FILE, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['id', 'profile', 'length', 'qty'])
        w.writeheader()
        w.writerows(items)

async def inventory_get(request):
    return web.json_response(load_inventory(), headers=CORS)

async def inventory_post(request):
    data   = await request.json()
    items  = load_inventory()
    prof   = str(data.get('profile', '')).strip()
    length = float(data.get('length', 0))
    qty    = int(data.get('qty', 1))
    for item in items:
        if item['profile'] == prof and item['length'] == length:
            item['qty'] += qty
            save_inventory(items)
            return web.json_response(items, headers=CORS)
    items.append({'id': str(int(time.time() * 1000)), 'profile': prof,
                  'length': length, 'qty': qty})
    save_inventory(items)
    return web.json_response(items, headers=CORS)

async def inventory_delete(request):
    item_id = request.match_info['id']
    items   = [i for i in load_inventory() if str(i['id']) != item_id]
    save_inventory(items)
    return web.json_response(items, headers=CORS)

async def inventory_replace(request):
    items = await request.json()
    if isinstance(items, list):
        save_inventory(items)
    return web.json_response({"ok": True}, headers=CORS)

async def inventory_options(request):
    return web.Response(headers=CORS)


# ─── SERVO STARTUP INIT (one-shot, after first PLC connect) ──
servo_init_done = False

async def servo_init_sequence():
    """One-time servo bring-up after first PLC connect:
       1. Wait D100.0 == 1 (servo initialized)
       2. Write D200.0 = 1 (servo home command)
       3. Wait D100.1 == 1 (home done)
       4. Write D200.1 = 1 (enable absolute mode)
       PLC clears its own handshake bits internally.
    """
    global servo_init_done

    await broadcast({"type": "log", "message": "⏳ Servo init: waiting for D100.0 (servo initialized)..."})
    while True:
        if await async_read_bit(100, 0) is True:
            break
        await asyncio.sleep(0.2)
    await broadcast({"type": "log", "message": "✔ D100.0 = 1 — sending home command (D200.0 = 1)"})

    if not await async_write_bit(200, 0, True, "Servo home command"):
        await broadcast({"type": "log", "message": "❌ Failed to write D200.0 — init aborted"})
        return

    await broadcast({"type": "log", "message": "⏳ Waiting for D100.1 (home done)..."})
    while True:
        if await async_read_bit(100, 1) is True:
            break
        await asyncio.sleep(0.2)
    await broadcast({"type": "log", "message": "✔ D100.1 = 1 — enabling absolute mode (D200.1 = 1)"})

    if not await async_write_bit(200, 1, True, "Enable absolute mode"):
        await broadcast({"type": "log", "message": "❌ Failed to write D200.1 — init aborted"})
        return

    servo_init_done = True
    await broadcast({"type": "log", "message": "✅ Servo init complete — ready for cuts"})


# ─── APP LIFECYCLE ────────────────────────────
async def start_background_tasks(app):
    app["plc_status_poll"] = asyncio.create_task(plc_status_poll_loop())
    app["neopixel_poll"]   = asyncio.create_task(neopixel_poll_loop())
    app["status_poll"]     = asyncio.create_task(status_poll_loop())
    app["printer_poll"]    = asyncio.create_task(printer_poll_loop())
    app["alerts_poll"]     = asyncio.create_task(alerts_poll_loop())
    app["servo_init"]      = asyncio.create_task(servo_init_sequence())

async def cleanup_background_tasks(app):
    keys = ["plc_status_poll", "neopixel_poll", "status_poll", "printer_poll", "alerts_poll", "servo_init"]
    for key in keys:
        app[key].cancel()
    await asyncio.gather(*[app[k] for k in keys], return_exceptions=True)
    fill_all((0, 0, 0))
    GPIO.cleanup()
    spi.close()
    modbus_client.close()
    print("🔌 PLC disconnected | 💡 LEDs off | 🔒 SPI closed | 🗼 Tower light off")


app = web.Application()
app.router.add_get("/",                         ws_handler)
app.router.add_get("/inventory",                inventory_get)
app.router.add_post("/inventory",               inventory_post)
app.router.add_post("/inventory/replace",       inventory_replace)
app.router.add_delete("/inventory/{id}",        inventory_delete)
app.router.add_route("OPTIONS", "/inventory",          inventory_options)
app.router.add_route("OPTIONS", "/inventory/{id}",     inventory_options)
app.router.add_route("OPTIONS", "/inventory/replace",  inventory_options)
app.on_startup.append(start_background_tasks)
app.on_cleanup.append(cleanup_background_tasks)

if __name__ == "__main__":
    print(f"🚀 Bridge running on ws://localhost:8765")
    print(f"🔌 Connecting to PLC {PLC_IP}:{PLC_PORT}...")
    connect_plc()
    web.run_app(app, host="localhost", port=8765, print=None)