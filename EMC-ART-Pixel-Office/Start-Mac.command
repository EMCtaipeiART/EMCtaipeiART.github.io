#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Please install Node.js LTS, then run this file again."
  read -r -p "Press Enter to close."
  exit 1
fi
node server.cjs --open
