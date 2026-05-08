#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "Ktrade Advisor local launcher"
echo "Folder: $ROOT_DIR"
echo ""

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 was not found."
  echo "Install Python 3 from https://www.python.org/downloads/macos/ or Homebrew, then run this launcher again."
  exit 1
fi

PYTHON_VERSION="$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')"
PYTHON_OK="$(python3 -c 'import sys; print(1 if sys.version_info >= (3, 9) else 0)')"
if [ "$PYTHON_OK" != "1" ]; then
  echo "Python $PYTHON_VERSION was found, but Python 3.9 or newer is required."
  echo "Install a newer Python 3, then run this launcher again."
  exit 1
fi

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

if [ ! -f ".venv/.requirements-installed" ] || [ "requirements.txt" -nt ".venv/.requirements-installed" ]; then
  echo "Installing Python dependencies..."
  python -m pip install --upgrade pip
  python -m pip install -r requirements.txt
  touch .venv/.requirements-installed
else
  echo "Python dependencies already installed."
fi

if [ ! -d "frontend/node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm --prefix frontend install
else
  echo "Frontend dependencies already installed."
fi

echo "Building frontend..."
npm --prefix frontend run build

PORT="${KTRADE_PORT:-8000}"
echo "Starting Ktrade Advisor at http://127.0.0.1:$PORT"
echo "Press Control-C in this window to stop the app."
python -m backend.app.main
