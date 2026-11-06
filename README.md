# PLC Kiosk — AS228T Bridge + Operator Dashboard

Raspberry Pi CM5 kiosk that bridges a Delta AS228T PLC (Modbus TCP) to a React operator UI,
drives a NeoPixel status strip and tower light, and prints cut-labels on a Brother QL-800.

## Layout

```
plc-kiosk/
├── backend/            Python bridge (runs on the Pi)
│   ├── Mergedcode.py     Main process: Modbus TCP + WebSocket + status polls
│   ├── print_label.py    Brother QL-800 subprocess (spawned per label)
│   ├── requirements.txt  Python deps (pymodbus, aiohttp, spidev, RPi.GPIO)
│   └── tools/            Standalone diagnostic scripts
│       ├── read.py         Read a block of PLC registers
│       ├── write_d402.py   Write a signed int32 DWORD to D402
│       └── registers.py    Legacy test writes (older register map)
├── frontend/           React UI served by Vite in kiosk Chromium
│   ├── src/              main.jsx, OperatorView.jsx, Login.jsx, ScrollPane.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── scripts/
│   └── start-kiosk.sh    Launcher: Vite + bridge + Chromium kiosk
└── docs/
    └── architecture.md   Process flow and register cheat-sheet
```

## What runs in kiosk mode

`scripts/start-kiosk.sh` starts three processes:

1. **Vite dev server** → serves the React UI on `http://localhost:5173`
2. **`Mergedcode.py`** → Modbus TCP bridge to the PLC at `192.168.1.5:502`, WebSocket on `ws://localhost:8765`, label-print subprocess spawner, NeoPixel + tower-light driver
3. **Chromium** in `--kiosk` mode pointing at `http://localhost:5173`

Bridge output is appended to `/home/ass/mergedcode.log` (not tracked in git).

## Setup on a fresh Raspberry Pi

```bash
# 1. Clone
git clone <this-repo> ~/plc-kiosk
cd ~/plc-kiosk

# 2. Backend venv + deps
python3 -m venv /home/ass/modbus_tcp
source /home/ass/modbus_tcp/bin/activate
pip install -r backend/requirements.txt

# 3. Frontend deps
cd frontend
npm install
cd ..

# 4. Deploy scripts to the paths the launcher expects
cp backend/Mergedcode.py /home/ass/Mergedcode.py
cp backend/print_label.py /home/ass/print_label.py
cp scripts/start-kiosk.sh /home/ass/start-kiosk.sh
chmod +x /home/ass/start-kiosk.sh

# 5. Launch
bash /home/ass/start-kiosk.sh
```

The `scripts/start-kiosk.sh` launcher references absolute paths under `/home/ass/`
to match the deployed production layout.

## Register map

See [`docs/architecture.md`](docs/architecture.md) for the full register cheat-sheet,
process flow, and machine-status priority logic.

Short version:
| Register | Direction | Purpose |
|---|---|---|
| D100.0 / D100.1 | PLC → us | Servo initialized / home done |
| D100.4 | PLC → us | Vacuum on (alert) |
| D100.6 | PLC → us | Cycle-complete ACK |
| D100.7 / D100.8 | PLC → us | Cut Start / Retract |
| D200.0 / D200.1 / D200.2 | us → PLC | Home / Absolute-mode / Error-reset |
| D300-D301 | PLC → us | Servo absolute position (signed int32) |
| D302-D303 | PLC → us | Motion/cutting indicator (signed int32) |
| D400-D409 | us → PLC | Calibration DWORDs (offset / speed / target length / steps / retract) |
| D500 (bits 0-14) | PLC → us | Error register (emergency, limits, servo/encoder faults) |

## Hardware

- Raspberry Pi CM5
- Delta AS228T PLC at `192.168.1.5:502` (static Pi IP `192.168.1.10` on `eth0`)
- 150-LED WS2812B strip via SPI0 (`spidev`)
- Tower light on GPIO17
- Brother QL-800 USB label printer at `/dev/usb/lp0`
- Waveshare 10.1" HDMI touchscreen (1920×1200, forced via `/boot/firmware/cmdline.txt`)
