#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if [ ! -d ".venv" ]; then
  echo "Creating local Python environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found."
  echo "Please install Node.js LTS from https://nodejs.org once, then run this launcher again."
  echo "Normal app usage after setup is still just this one launcher."
  exit 1
fi

echo "Installing Python dependencies..."
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

if [ ! -d "frontend/node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm --prefix frontend install
fi

echo "Building frontend..."
npm --prefix frontend run build

echo "Starting Ktrade Advisor at http://127.0.0.1:8000"
python -m backend.app.main
