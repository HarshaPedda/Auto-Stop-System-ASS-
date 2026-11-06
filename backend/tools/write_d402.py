#!/usr/bin/env python3
"""Write a signed 32-bit DWORD to D402-D403 (D402 = low word, D403 = high word)."""
from pymodbus.client import ModbusTcpClient

PLC_IP   = '192.168.1.5'
PLC_PORT = 502
REG      = 402
VALUE    = 400   # ← edit this to the value you want to write (signed int32)

client = ModbusTcpClient(PLC_IP, port=PLC_PORT, timeout=2, retries=3)

if not client.connect():
    print("Connection failed")
    raise SystemExit(1)

try:
    value_u32 = VALUE & 0xFFFFFFFF          # two's-complement encoding
    low  =  value_u32        & 0xFFFF
    high = (value_u32 >> 16) & 0xFFFF

    r_lo = client.write_register(REG,     low)
    r_hi = client.write_register(REG + 1, high)

    if r_lo.isError() or r_hi.isError():
        print(f"Write error — D{REG}: {r_lo}, D{REG+1}: {r_hi}")
    else:
        print(f"Wrote D{REG}-D{REG+1} = {VALUE}  (low=0x{low:04X}, high=0x{high:04X})")

    # Verify: read back
    r = client.read_holding_registers(REG, count=2)
    if not r.isError():
        raw = (r.registers[1] << 16) | r.registers[0]
        signed = raw - 0x100000000 if raw & 0x80000000 else raw
        print(f"Read back D{REG}-D{REG+1} = {signed}")
finally:
    client.close()
