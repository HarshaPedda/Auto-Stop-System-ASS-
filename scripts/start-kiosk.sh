#!/bin/bash
# Kill any existing instances
pkill -f "vite" 2>/dev/null
pkill -f "plc_bridge" 2>/dev/null
pkill -f "Mergedcode" 2>/dev/null
pkill -f "chromium" 2>/dev/null
fuser -k 8765/tcp 2>/dev/null
sleep 1

# Clear Chromium session lock
rm -f ~/.config/chromium/Default/SingletonLock
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' ~/.config/chromium/Default/Preferences 2>/dev/null
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' ~/.config/chromium/Default/Preferences 2>/dev/null

# Start the Vite dev server in background
cd /home/ass/ASS-SOFTWARE && npm run dev &

# Wait until port 5173 is actually responding (up to 30 seconds)
echo "Waiting for Vite server..."
for i in $(seq 1 30); do
  if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "Vite server is ready!"
    break
  fi
  sleep 1
done

# Start Mergedcode.py — output goes to ~/mergedcode.log (appended each run)
LOG_FILE=/home/ass/mergedcode.log
echo "" >> "$LOG_FILE"
echo "===== Bridge started at $(date) =====" >> "$LOG_FILE"
source /home/ass/modbus_tcp/bin/activate && python3 -u /home/ass/Mergedcode.py >> "$LOG_FILE" 2>&1 &
sleep 2

# Launch Chromium in kiosk mode
chromium \
  --kiosk \
  --kiosk-printing \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --no-first-run \
  --touch-events=enabled \
  --disable-pinch \
  http://localhost:5173
