#!/usr/bin/env python3
"""
AS228T PLC Modbus TCP Test Script - Write Test Values to Registers
Pi CM5 → PLC 192.168.1.5:502
Compatible with pymodbus 3.12.x
"""
from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusException
 
# ─── CONFIG ───────────────────────────────
PLC_IP   = '192.168.1.5'
PLC_PORT = 502
SLAVE_ID = 1  # Modbus slave ID — passed at client level in pymodbus 3.12+
 
# In pymodbus 3.12+, slave ID goes in the constructor, not per-call
client = ModbusTcpClient(PLC_IP, port=PLC_PORT, timeout=2, retries=3)
 
def connect_plc():
    if client.connect():
        print("✅ Connected to AS228T PLC!")
        return True
    print("❌ PLC Connection Failed!")
    return False
 
def write_holding_register(reg, value, desc):
    """Write single 16-bit holding register"""
    try:
        result = client.write_register(reg, value)
        if not result.isError():
            print(f"✅ {desc:25s} D{reg:04d} = {value:6d}")
        else:
            print(f"❌ WRITE ERROR {desc} D{reg:04d}")
    except ModbusException as e:
        print(f"❌ Modbus Error D{reg}: {e}")
 
def write_32bit_register(high_reg, low_reg, value_32, desc):
    """Write 32-bit value across two consecutive registers"""
    high_word = (value_32 >> 16) & 0xFFFF
    low_word  =  value_32        & 0xFFFF
    try:
        r_hi = client.write_register(high_reg, high_word)
        r_lo = client.write_register(low_reg,  low_word)
        if not r_hi.isError() and not r_lo.isError():
            print(f"✅ {desc:25s} D{high_reg:04d}-D{low_reg:04d} = {value_32:8d} (0x{value_32:08X})")
        else:
            print(f"❌ 32BIT WRITE ERROR {desc}")
    except ModbusException as e:
        print(f"❌ 32BIT Modbus Error: {e}")
 
def read_and_verify(reg, expected, desc):
    """Read back register and compare to expected value"""
    try:
        result = client.read_holding_registers(reg, count=1)
        if not result.isError():
            actual = result.registers[0]
            status = "✅" if actual == expected else "⚠️"
            print(f"   {status} VERIFY {desc:25s} D{reg:04d} = {actual:6d} (exp: {expected})")
        else:
            print(f"❌ READ ERROR {desc}")
    except ModbusException as e:
        print(f"❌ READ Modbus Error: {e}")
 
def test_all_registers():
    print("\n🚀 WRITING TEST VALUES TO ALL REGISTERS...\n")
 
    # D1000 - Stop flag (1=Stop)
    write_holding_register(1000, 25, "PLC-> 4-Stop")
    read_and_verify(1000, 25, "PLC-> 4-Stop")
 
    # D1001-1002: Target Position 32-bit (1000 mm)
    write_32bit_register(1001, 1002, 1000, "PLC-> Target Pos")
    read_and_verify(1001, (1000 >> 16) & 0xFFFF, "Target Pos HIGH")
    read_and_verify(1002,  1000        & 0xFFFF,  "Target Pos LOW")
 
    # D1003: Velocity (500 mm/s)
    write_holding_register(1003, 500, "PLC-> Velocity")
    read_and_verify(1003, 500, "PLC-> Velocity")
 
    # D1004: Command (1=Execute)
    write_holding_register(1004, 1, "PLC-> Command")
    read_and_verify(1004, 1, "PLC-> Command")
 
    # D1010: Status (4=Error, 2=Homing, 3=Done)
    write_holding_register(1010, 4, "PLC-> Status")
    read_and_verify(1010, 4, "PLC-> Status")
 
    # D1011-1012: Actual Position 32-bit (750 mm)
    write_32bit_register(1011, 1012, 750, "PLC-> Actual Pos")
 
    # D1013: Actual Velocity (250 mm/s)
    write_holding_register(1013, 250, "PLC-> Actual Vel")
 
    # D1014: Error Code (123=Test Error)
    write_holding_register(1014, 123, "PLC-> Error Code")
    read_and_verify(1014, 123, "PLC-> Error Code")
 
    # D1015: Home Flag (1=Homed)
    write_holding_register(1015, 1, "PLC-> Home Flag")
    read_and_verify(1015, 1, "PLC-> Home Flag")
 
if __name__ == "__main__":
    if connect_plc():
        try:
            test_all_registers()
            print("\n All REGISTERS WRITTEN SUCCESSFULLY!")
            print("\n Test Values Written:")
            print("   D1000=1         (Stop)")
            print("   D1001-D1002=1000mm  (Target Position)")
            print("   D1003=500       (Velocity)")
            print("   D1004=1         (Command Execute)")
            print("   D1010=4         (Status=Error)")
            print("   D1011-D1012=750mm   (Actual Position)")
            print("   D1013=250       (Actual Velocity)")
            print("   D1014=123       (Error Code)")
            print("   D1015=1         (Homed)")
            input("\n Press Enter to exit...")
        except KeyboardInterrupt:
            print("\n Interrupted by user")
        except Exception as e:
            print(f"Unexpected error: {e}")
        finally:
            client.close()
            print("PLC Connection Closed")
    else:
        print("Cannot proceed without PLC connection.")