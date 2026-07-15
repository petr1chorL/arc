#!/bin/sh
set -eu

python -m app.bootstrap
python -m app.v1_lite_seed --json --skip-if-provider-unavailable
envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

uvicorn app.main:app --app-dir /app/api --host 127.0.0.1 --port 8000 &
api_pid=$!

cleanup() {
  nginx -s quit >/dev/null 2>&1 || true
  if kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
  fi
  wait "$api_pid" >/dev/null 2>&1 || true
}

on_signal() {
  trap - EXIT
  cleanup
  exit 0
}

trap on_signal INT TERM
trap cleanup EXIT

attempt=0
until python -c "import json, urllib.request; payload=json.load(urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=1)); assert payload.get('status') == 'ok'" 2>/dev/null; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid" || true
    echo "FastAPI exited before becoming healthy" >&2
    exit 1
  fi

  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "FastAPI did not become healthy within 30 seconds" >&2
    exit 1
  fi
  sleep 1
done

nginx
wait "$api_pid"
