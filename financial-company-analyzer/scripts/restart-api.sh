#!/bin/sh
# Restart the API for local smoke testing. Matches only the built entrypoint so the
# calling shell is never caught by the pattern.
PIDFILE=/tmp/claude-0/api.pid
if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null; sleep 1; fi
cd "$(dirname "$0")/.." || exit 1
setsid node server/dist/index.js > /tmp/claude-0/server.log 2>&1 &
echo $! > "$PIDFILE"
sleep 2
