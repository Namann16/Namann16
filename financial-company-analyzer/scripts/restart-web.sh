#!/bin/sh
# Run the Vite dev server for smoke testing. It proxies /api to the running API,
# which is what the browser test needs.
PIDFILE=/tmp/claude-0/web.pid
if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null; sleep 1; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/client" || exit 1
setsid npx vite --port 5173 --strictPort --host 127.0.0.1 > /tmp/claude-0/web.log 2>&1 &
echo $! > "$PIDFILE"
sleep 4
