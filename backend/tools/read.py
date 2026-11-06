from pymodbus.client import ModbusTcpClient

PLC_IP = '192.168.1.5'
PLC_PORT = 502
SLAVE_ID = 1


def s32(low, high):
    """Two 16-bit words → signed 32-bit int (little-endian word order)."""
    raw = (high << 16) | low
    return raw - 0x100000000 if raw & 0x80000000 else raw


client = ModbusTcpClient(PLC_IP, port=PLC_PORT)
if not client.connect():
    print("Connection failed")
    raise SystemExit(1)

try:
    # ── D100 word, bits 0-5 ──
    r = client.read_holding_registers(address=100, count=1, slave=SLAVE_ID)
    if r.isError():
        print(f"D100 read error: {r}")
    else:
        d100 = r.registers[0]
        print(f"D100 word = {d100}  (binary: {d100:016b})")
        for bit in range(6):
            print(f"  D100.{bit} = {int(bool(d100 & (1 << bit)))}")

    # ── D200 word, bits 0-3 (command register) ──
    r = client.read_holding_registers(address=200, count=1, slave=SLAVE_ID)
    if r.isError():
        print(f"\nD200 read error: {r}")
    else:
        d200 = r.registers[0]
        print(f"\nD200 word = {d200}  (binary: {d200:016b})")
        for bit in range(4):
            print(f"  D200.{bit} = {int(bool(d200 & (1 << bit)))}")

    # ── DWORDs D300, D302 (signed int32) ──
    r = client.read_holding_registers(address=300, count=4, slave=SLAVE_ID)
    if r.isError():
        print(f"\nD300-D303 read error: {r}")
    else:
        d300 = s32(r.registers[0], r.registers[1])
        d302 = s32(r.registers[2], r.registers[3])
        print(f"\nD300 = {d300}")
        print(f"D302 = {d302}")

    # ── DWORDs D400, D402, D404, D406, D408 (signed int32) ──
    r = client.read_holding_registers(address=400, count=10, slave=SLAVE_ID)
    if r.isError():
        print(f"\nD400-D409 read error: {r}")
    else:
        print()
        for i, name in enumerate(["D400", "D402", "D404", "D406", "D408"]):
            val = s32(r.registers[i * 2], r.registers[i * 2 + 1])
            print(f"{name} = {val}")

finally:
    client.close()
