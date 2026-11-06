# Architecture & Process Flow

## Kiosk boot sequence

`scripts/start-kiosk.sh` launches three processes in order:

1. **Vite dev server** — React UI at `http://localhost:5173`
2. **`Mergedcode.py`** — Modbus TCP bridge + WebSocket server on `ws://localhost:8765`
3. **Chromium** — fullscreen kiosk pointed at the UI

## Backend background tasks (always running)

| Task | Period | Reads | Writes | Role |
|---|---|---|---|---|
| `plc_status_poll_loop` | 0.5 s | D200 | — | Heartbeat; reconnects on persistent failure |
| `neopixel_poll_loop` | 1.0 s | D500 (bits 0-14) | — | RED on any error bit; ORANGE if cutting; GREEN otherwise |
| `status_poll_loop` | 0.1 s | D300-D303, D200.0, D100.0/1/7/8 | — | Drives machine status + position tile |
| `printer_poll_loop` | 1.0 s | — | — | Watches `/dev/usb/lp0` |
| `alerts_poll_loop` | 0.5 s | D500, D100.4 | — | Broadcasts popup alerts on bit transitions |
| `servo_init_sequence` | one-shot | D100.0, D100.1 | D200.0, D200.1 | Startup bring-up |

## Servo init (one-shot at app startup)

```
poll D100.0 == 1    (servo initialized — PLC sets)
write D200.0 = 1    (home command)
poll D100.1 == 1    (home done — PLC sets)
write D200.1 = 1    (enable absolute mode)
```
PLC clears its own handshake bits internally. We never write 0 to D100.x or D200.x.

## Machine status logic (priority, top-down)

| Priority | Condition | Status label |
|---|---|---|
| 1 | D302 > 0 OR D100.7 == 1 | **CUTTING** |
| 2 | D100.8 == 1 | **RETRACTED** |
| 3 | D200.0 == 1 | **HOMING** (user pressed RESET) |
| 4 | D100.1 == 1 AND D300 == 0 | **HOME** |
| 5 | D100.0 == 1 | **READY** |

## Per-cut sequence (on START click)

```
Pre-step: write D200.1 = 1               (re-assert absolute mode)

For each cut:
  1. length = -cut.length × 10            (tenths-of-mm, negative)
  2. write length → D404-D405              (signed DWORD)
  3. wait D100.6 falling → rising edge     (ACK; PLC clears internally)
  4. spawn print_label.py subprocess       (Brother QL-800)
  5. broadcast progress → next cut

After all cuts: broadcast "sequence_done"
```

## WebSocket commands (frontend → backend)

| Command | Action |
|---|---|
| `start_sequence` | Begins `run_sequence` with list of cuts |
| `stop_sequence` | Sets `stop_event`; halts current cut cycle |
| `home` | Writes D200.0 = 1 (manual re-home) |
| `error_reset` | Writes D200.2 = 1, then D200.0 = 1 (clear error + home) |
| `set_calibration` | Writes D400, D402, D406, D408 DWORDs |
| `save_steps` | Writes only D406 + D402 (incremental speed tune) |
| `optimize` | Writes D200.0 = 0 (clear sequence-done flag) |

## Register map — full

### Bits we read (PLC → us)
| Register | Purpose |
|---|---|
| D100.0 | Servo initialized flag |
| D100.1 | Home done flag |
| D100.4 | Vacuum on (alert popup) |
| D100.6 | Cycle-complete ACK (per cut) |
| D100.7 | Cut Start Bit → CUTTING status |
| D100.8 | Retract Bit → RETRACTED status |
| D200.0 | Echo of home command |
| D500.0 | Emergency alarm |
| D500.1 / D500.2 | Positive / negative end limit |
| D500.3 | ABS given before homing on power-on |
| D500.4 | Servo over current |
| D500.5 | Servo over voltage |
| D500.6 | Servo under voltage |
| D500.7 | Servo overload |
| D500.8 | Servo over speed |
| D500.9 | Encoder communication error |
| D500.A (10) | Input phase loss |
| D500.B-D (11-13) | Encoder alarms 1-3 |
| D500.E (14) | ABS position overflow |

### DWORDs we read (PLC → us, signed int32)
| Register | Purpose |
|---|---|
| D300-D301 | Servo absolute position (live, broadcast every 100 ms on change) |
| D302-D303 | Motion / cutting indicator |

### Bits we write (us → PLC)
| Register | Trigger |
|---|---|
| D200.0 | Home command — RESET button, init step 2, error_reset step 2 |
| D200.1 | Enable absolute mode — init step 4, every sequence start |
| D200.2 | Error reset — RESET-in-popup button (step 1 of `error_reset`) |

### DWORDs we write (us → PLC, signed int32)
| Register | Source | Written by |
|---|---|---|
| D400-D401 | Calibration offset (`distMove − distMeas`) | Save Calibration |
| D402-D403 | Speed (`abs(stepsPerUnit / 2)`) | Save Calibration, inline Save on steps field |
| D404-D405 | Target cut length (`-length × 10`) | Per-cut during sequence |
| D406-D407 | Steps per unit | Save Calibration, inline Save on steps field |
| D408-D409 | Retract position | Save Calibration |

## Display / resolution fix

Pi uses full KMS (`vc4-kms-v3d` + labwc Wayland). EDID handshake intermittently fails
on the Waveshare 10.1" (G) panel, so the mode is forced via `/boot/firmware/cmdline.txt`:

```
video=HDMI-A-2:1920x1200@60D
```

The `D` suffix forces the mode without EDID.

## Network

- Pi `eth0` static IP `192.168.1.10/24` (set via NetworkManager profile `plc-static`)
- PLC at `192.168.1.5:502` (Modbus TCP)
- Pi `wlan0` is separate (unrelated to PLC)
