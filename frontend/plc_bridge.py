import asyncio
import socket
import struct
import json
import csv
import os
import time
from aiohttp import web
import aiohttp

INVENTORY_FILE = os.path.expanduser("~/inventory_profiles.csv")

PLC_IP        = "192.168.1.5"
PLC_PORT      = 502
MODBUS_PORT   = 502          # Modbus TCP port for register polling
D500_ADDR     = 500          # D500 register (16-bit int) → FEEDING when > 0
D502_ADDR     = 502          # D502 register (16-bit int) → CUTTING when value increases
D204_ADDR     = 204          # D204 register (16-bit signed int) → HOME when negative
POLL_INTERVAL = 0.3          # Poll interval (300 ms)

tcp_socket       = None
poll_socket_d500 = None
poll_socket_d502 = None
poll_socket_d204 = None
sequence_task    = None
stop_event       = asyncio.Event()
ws_clients       = set()


async def broadcast(msg):
    data = json.dumps(msg)
    for ws in list(ws_clients):
        try:
            await ws.send_str(data)
        except Exception:
            pass


def tcp_send(data: bytes):
    global tcp_socket
    if tcp_socket is None:
        raise ConnectionError("Not connected to PLC")
    try:
        tcp_socket.sendall(data)
    except Exception as e:
        tcp_socket = None
        raise


async def auto_connect_loop():
    global tcp_socket
    while True:
        if tcp_socket is None:
            try:
                loop = asyncio.get_event_loop()

                def _connect():
                    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    sock.settimeout(1)
                    sock.connect((PLC_IP, PLC_PORT))
                    sock.settimeout(1.0)
                    return sock

                sock = await loop.run_in_executor(None, _connect)
                tcp_socket = sock
                await broadcast({"type": "status", "connected": True,  "message": f"✔ Connected to PLC {PLC_IP}:{PLC_PORT}"})
                await broadcast({"type": "log",    "message": f"✔ Connected to PLC {PLC_IP}:{PLC_PORT}"})
                print(f"TCP connected to {PLC_IP}:{PLC_PORT}")
            except Exception:
                pass
        await asyncio.sleep(0.003)


async def wait_for_ack():
    global tcp_socket
    loop = asyncio.get_event_loop()
    while not stop_event.is_set():
        if tcp_socket is None:
            return False
        try:
            data = await loop.run_in_executor(None, lambda: tcp_socket.recv(16))
            if b"1" in data:
                return True
        except socket.timeout:
            continue
        except Exception:
            tcp_socket = None
            await broadcast({"type": "status", "connected": False, "message": "PLC disconnected"})
            return False
    return False


PRINT_LABEL_SCRIPT = os.path.expanduser("~/print_label.py")

async def _print_ql800(cut, position):
    """Print a Brother QL-800 label for a completed cut. Fire-and-forget."""
    data = {
        "pieceLabel":  cut.get("label", f"Cut {position}"),
        "barLabel":    cut.get("barLabel", ""),
        "profile":     cut.get("profile", ""),
        "length":      cut.get("length", ""),
        "desc":        cut.get("desc", ""),
        "zone":        "",
        "cutPosition": position,
    }
    try:
        proc = await asyncio.create_subprocess_exec(
            "python3", PRINT_LABEL_SCRIPT, json.dumps(data),
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


async def run_sequence(ws, cuts):
    global sequence_task
    total = len(cuts)
    for i, cut in enumerate(cuts):
        if stop_event.is_set():
            await ws.send_str(json.dumps({"type": "sequence_stopped"}))
            await ws.send_str(json.dumps({"type": "log", "message": "■ Sequence stopped"}))
            await broadcast({"type": "machine_status", "status": "homing"})
            sequence_task = None
            return

        # Clear any lingering cutting state before starting next feed
        await broadcast({"type": "machine_status", "status": "d502_idle"})
        # Sending length to D1001 → FEEDING
        await broadcast({"type": "machine_status", "status": "feeding"})
        length_bytes = str(cut["length"]).encode()
        try:
            tcp_send(length_bytes)
        except Exception as e:
            await ws.send_str(json.dumps({"type": "log", "message": f"⚠ Send failed: {e}"}))
            await ws.send_str(json.dumps({"type": "sequence_stopped"}))
            await broadcast({"type": "machine_status", "status": "home"})
            sequence_task = None
            return

        label = cut.get("label", f"Cut {i + 1}")
        await ws.send_str(json.dumps({"type": "log", "message": f"▶ [{i+1}/{total}] {label} → {cut['length']} mm"}))
        print(f"Sent [{i+1}/{total}] {label}: {cut['length']} mm")

        if i < total - 1:
            await ws.send_str(json.dumps({"type": "log", "message": "⏳ Waiting for ack..."}))
            acked = await wait_for_ack()
            if not acked:
                await ws.send_str(json.dumps({"type": "sequence_stopped"}))
                await ws.send_str(json.dumps({"type": "log", "message": "■ Sequence stopped (no ack / stopped)"}))
                await broadcast({"type": "machine_status", "status": "home"})
                sequence_task = None
                return
            # ACK received → print label for this cut, mark done, advance
            asyncio.create_task(_print_ql800(cut, i + 1))
            await ws.send_str(json.dumps({"type": "log", "message": f"[PRINT] Printing label: {label}"}))
            await ws.send_str(json.dumps({"type": "sequence_progress", "idx": i, "total": total}))
            await ws.send_str(json.dumps({"type": "log", "message": "✔ Ack received → cutting"}))
            await broadcast({"type": "machine_status", "status": "cutting"})

    # Last cut complete — print its label then signal done
    asyncio.create_task(_print_ql800(cuts[total - 1], total))
    await ws.send_str(json.dumps({"type": "log", "message": f"[PRINT] Printing label: {cuts[total-1].get('label', f'Cut {total}')}"}))
    await ws.send_str(json.dumps({"type": "sequence_progress", "idx": total - 1, "total": total}))
    await ws.send_str(json.dumps({"type": "sequence_done", "total": total}))
    await ws.send_str(json.dumps({"type": "log", "message": f"✅ Sequence complete — {total} cuts sent"}))
    await broadcast({"type": "machine_status", "status": "home"})
    print(f"Sequence complete: {total} cuts sent")
    sequence_task = None


async def run_home(ws):
    """Send D1000=1, wait for PLC ACK (D1000 back to 0 = home complete)."""
    await broadcast({"type": "machine_status", "status": "homing"})
    try:
        tcp_send(b"D1000=1")
    except Exception as e:
        await ws.send_str(json.dumps({"type": "log", "message": f"⚠ Home send failed: {e}"}))
        await broadcast({"type": "machine_status", "status": "home"})
        return
    await ws.send_str(json.dumps({"type": "log", "message": "🏠 Homing — waiting for PLC (D1000→0)..."}))
    acked = await wait_for_ack()
    await broadcast({"type": "machine_status", "status": "home"})
    if acked:
        await ws.send_str(json.dumps({"type": "log", "message": "✔ Home complete"}))
    else:
        await ws.send_str(json.dumps({"type": "log", "message": "⚠ Home: no ack received"}))


async def ws_handler(request):
    global sequence_task
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    ws_clients.add(ws)
    print("Frontend connected")

    # Send current PLC connection status to newly connected client
    connected = tcp_socket is not None
    await ws.send_str(json.dumps({
        "type": "status",
        "connected": connected,
        "message": f"✔ Connected to PLC {PLC_IP}:{PLC_PORT}" if connected else f"Connecting to PLC {PLC_IP}:{PLC_PORT}...",
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
                stop_event.clear()
                if sequence_task and not sequence_task.done():
                    sequence_task.cancel()
                sequence_task = asyncio.create_task(run_sequence(ws, cuts))

            elif action == "stop_sequence":
                stop_event.set()
                await ws.send_str(json.dumps({"type": "log", "message": "■ Stopping..."}))

            elif action == "home":
                stop_event.set()
                asyncio.create_task(run_home(ws))

        elif msg.type == aiohttp.WSMsgType.ERROR:
            print(f"WebSocket error: {ws.exception()}")

    ws_clients.discard(ws)
    if sequence_task and not sequence_task.done():
        sequence_task.cancel()
    print("Frontend disconnected")
    return ws


def _make_modbus_conn():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(2.0)
    s.connect((PLC_IP, MODBUS_PORT))
    s.settimeout(1.0)
    return s


async def d500_poll_loop():
    """Poll D500 (16-bit int, 1 reg). Value > 0 → FEEDING."""
    global poll_socket_d500
    last_feeding = False
    tx_id = 0
    loop = asyncio.get_event_loop()

    while True:
        try:
            if poll_socket_d500 is None:
                try:
                    poll_socket_d500 = await loop.run_in_executor(None, _make_modbus_conn)
                    print("D500 poll connected")
                except Exception:
                    await asyncio.sleep(2.0)
                    continue

            tx_id = (tx_id + 1) & 0xFFFF
            req = struct.pack('>HHHBBHH', tx_id, 0x0000, 0x0006, 0x01, 0x03, D500_ADDR, 1)

            def _q500(r):
                poll_socket_d500.sendall(r)
                return poll_socket_d500.recv(256)

            resp = await asyncio.wait_for(loop.run_in_executor(None, _q500, req), timeout=1.5)

            # Response: 9 byte header + 2 bytes data
            if resp and len(resp) >= 11 and resp[7] == 0x03 and resp[8] >= 2:
                value = struct.unpack('>H', resp[9:11])[0]   # unsigned 16-bit
                feeding = value > 0
                if feeding != last_feeding:
                    last_feeding = feeding
                    status = "feeding" if feeding else "d500_idle"
                    await broadcast({"type": "machine_status", "status": status, "d500": value})
                    print(f"D500={value} → {status}")

        except Exception as e:
            print(f"D500 poll error: {e}")
            try: poll_socket_d500.close()
            except Exception: pass
            poll_socket_d500 = None
            await asyncio.sleep(2.0)

        await asyncio.sleep(POLL_INTERVAL)


async def d502_poll_loop():
    """Poll D502 (16-bit int, 1 reg). Value increasing → CUTTING."""
    global poll_socket_d502
    last_value = None
    last_cutting = False
    tx_id = 0
    loop = asyncio.get_event_loop()

    while True:
        try:
            if poll_socket_d502 is None:
                try:
                    poll_socket_d502 = await loop.run_in_executor(None, _make_modbus_conn)
                    print("D502 poll connected")
                except Exception:
                    await asyncio.sleep(2.0)
                    continue

            tx_id = (tx_id + 1) & 0xFFFF
            req = struct.pack('>HHHBBHH', tx_id, 0x0000, 0x0006, 0x01, 0x03, D502_ADDR, 1)

            def _q502(r):
                poll_socket_d502.sendall(r)
                return poll_socket_d502.recv(256)

            resp = await asyncio.wait_for(loop.run_in_executor(None, _q502, req), timeout=1.5)

            if resp and len(resp) >= 11 and resp[7] == 0x03 and resp[8] >= 2:
                value = struct.unpack('>H', resp[9:11])[0]   # unsigned 16-bit
                if last_value is None:
                    last_value = value
                cutting = value > last_value
                if cutting != last_cutting:
                    last_cutting = cutting
                    status = "cutting" if cutting else "d502_idle"
                    await broadcast({"type": "machine_status", "status": status, "d502": value})
                    print(f"D502={value} (prev={last_value}) → {status}")
                last_value = value

        except Exception as e:
            print(f"D502 poll error: {e}")
            try: poll_socket_d502.close()
            except Exception: pass
            poll_socket_d502 = None
            last_value = None
            await asyncio.sleep(2.0)

        await asyncio.sleep(POLL_INTERVAL)


async def d204_poll_loop():
    """Poll D204 (16-bit signed int, 1 reg). Negative value → HOME."""
    global poll_socket_d204
    last_home = False
    tx_id = 0
    loop = asyncio.get_event_loop()

    while True:
        try:
            if poll_socket_d204 is None:
                try:
                    poll_socket_d204 = await loop.run_in_executor(None, _make_modbus_conn)
                    print(f"D204 poll connected")
                except Exception:
                    await asyncio.sleep(2.0)
                    continue

            tx_id = (tx_id + 1) & 0xFFFF
            req = struct.pack('>HHHBBHH', tx_id, 0x0000, 0x0006, 0x01, 0x03, D204_ADDR, 1)

            def _q204(r):
                poll_socket_d204.sendall(r)
                return poll_socket_d204.recv(256)

            resp = await asyncio.wait_for(loop.run_in_executor(None, _q204, req), timeout=1.5)

            # Response: 9 bytes header + 2 bytes data
            if resp and len(resp) >= 11 and resp[7] == 0x03 and resp[8] >= 2:
                value = struct.unpack('>h', resp[9:11])[0]  # signed 16-bit
                is_home = value < 0
                if is_home != last_home:
                    last_home = is_home
                    if is_home:
                        await broadcast({"type": "machine_status", "status": "home", "d204": value})
                        print(f"D204={value} → HOME")
                    else:
                        print(f"D204={value} → no longer negative")

        except Exception as e:
            print(f"D204 poll error: {e}")
            try: poll_socket_d204.close()
            except Exception: pass
            poll_socket_d204 = None
            await asyncio.sleep(2.0)

        await asyncio.sleep(POLL_INTERVAL)


# ── Inventory CSV helpers ──────────────────────────────────────────────────────

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


CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}


async def inventory_get(request):
    return web.json_response(load_inventory(), headers=CORS)


async def inventory_post(request):
    data   = await request.json()
    items  = load_inventory()
    prof   = str(data.get('profile', '')).strip()
    length = float(data.get('length', 0))
    qty    = int(data.get('qty', 1))
    # Merge if same profile + length already exists
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
    """Replace the entire inventory list (bulk save from frontend)."""
    items = await request.json()
    if isinstance(items, list):
        save_inventory(items)
    return web.json_response({"ok": True}, headers=CORS)


async def inventory_options(request):
    return web.Response(headers=CORS)


async def start_background_tasks(app):
    app["auto_connect"] = asyncio.create_task(auto_connect_loop())
    app["d500_poll"]    = asyncio.create_task(d500_poll_loop())
    app["d502_poll"]    = asyncio.create_task(d502_poll_loop())
    app["d204_poll"]    = asyncio.create_task(d204_poll_loop())


async def cleanup_background_tasks(app):
    keys = ("auto_connect", "d500_poll", "d502_poll", "d204_poll")
    for key in keys:
        app[key].cancel()
    await asyncio.gather(*[app[k] for k in keys], return_exceptions=True)


app = web.Application()
app.router.add_get("/",                  ws_handler)
app.router.add_get("/inventory",            inventory_get)
app.router.add_post("/inventory",           inventory_post)
app.router.add_post("/inventory/replace",   inventory_replace)
app.router.add_delete("/inventory/{id}",    inventory_delete)
app.router.add_route("OPTIONS", "/inventory",          inventory_options)
app.router.add_route("OPTIONS", "/inventory/{id}",     inventory_options)
app.router.add_route("OPTIONS", "/inventory/replace",  inventory_options)
app.on_startup.append(start_background_tasks)
app.on_cleanup.append(cleanup_background_tasks)

if __name__ == "__main__":
    print(f"Bridge running on ws://localhost:8765")
    print(f"Auto-connecting to PLC {PLC_IP}:{PLC_PORT}...")
    web.run_app(app, host="localhost", port=8765, print=None)
