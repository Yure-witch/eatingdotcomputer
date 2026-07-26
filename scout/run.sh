#!/bin/sh
# Load env + run the worker. Usage: ./run.sh   (or via nohup / systemd)
cd "$(dirname "$0")"
set -a; . ./scout.env; set +a
exec node scout.js
