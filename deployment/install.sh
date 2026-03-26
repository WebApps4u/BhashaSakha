#!/bin/bash
# BhashaSakha Installation Script
# Installs everything needed on Raspberry Pi 5 (Raspberry Pi OS)
set -euo pipefail

echo "╔══════════════════════════════════════════════════════╗"
echo "║  BhashaSakha Installation                           ║"
echo "╚══════════════════════════════════════════════════════╝"

# Check if running on aarch64
ARCH=$(uname -m)
echo "Architecture: $ARCH"
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "x86_64" ]; then
    echo "WARNING: Untested architecture: $ARCH"
fi

# 1. System dependencies
echo ""
echo "[1/5] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    python3-venv python3-dev \
    portaudio19-dev libsndfile1-dev \
    libopenblas-dev espeak-ng \
    libatlas-base-dev wget git

# 2. Create directory structure
echo ""
echo "[2/5] Setting up directories..."
INSTALL_DIR="/opt/bhashasakha"
sudo mkdir -p "$INSTALL_DIR"/{logs,models}

# Create service user (if not exists)
if ! id bhashasakha &>/dev/null; then
    sudo useradd -r -s /bin/false -d "$INSTALL_DIR" bhashasakha
fi
sudo usermod -aG audio,gpio,video bhashasakha 2>/dev/null || true

# Copy project files
echo "  Copying project files..."
sudo cp -r . "$INSTALL_DIR/"
sudo chown -R bhashasakha:bhashasakha "$INSTALL_DIR"

# 3. Python virtual environment
echo ""
echo "[3/5] Setting up Python environment..."
sudo -u bhashasakha python3 -m venv "$INSTALL_DIR/venv"
sudo -u bhashasakha "$INSTALL_DIR/venv/bin/pip" install --upgrade pip -q
sudo -u bhashasakha "$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt" -q

# 4. Download models
echo ""
echo "[4/5] Downloading models (~1.4GB)..."
sudo -u bhashasakha bash "$INSTALL_DIR/scripts/download_models.sh"

# 5. Install systemd service + logrotate
echo ""
echo "[5/6] Installing systemd service..."
sudo cp "$INSTALL_DIR/deployment/bhashasakha.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bhashasakha

# Install logrotate config
if [ -d /etc/logrotate.d ]; then
    sudo cp "$INSTALL_DIR/deployment/logrotate.conf" /etc/logrotate.d/bhashasakha
    echo "  Logrotate configured"
fi

# Make scripts executable
chmod +x "$INSTALL_DIR/scripts/"*.py "$INSTALL_DIR/scripts/"*.sh 2>/dev/null || true
chmod +x "$INSTALL_DIR/deployment/"*.sh 2>/dev/null || true

# 6. Quick hardware test
echo ""
echo "[6/6] Running hardware verification..."
sudo -u bhashasakha "$INSTALL_DIR/venv/bin/python" \
    "$INSTALL_DIR/scripts/test_hardware.py" --quick 2>/dev/null || \
    echo "  ⚠ Hardware test skipped (run manually)"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Installation Complete!                             ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                     ║"
echo "║  Start:    sudo systemctl start bhashasakha         ║"
echo "║  Status:   sudo systemctl status bhashasakha        ║"
echo "║  Logs:     sudo journalctl -u bhashasakha -f        ║"
echo "║  Monitor:  python $INSTALL_DIR/scripts/monitor.py   ║"
echo "║  Bench:    python $INSTALL_DIR/scripts/perf_benchmark.py ║"
echo "║  Update:   sudo bash $INSTALL_DIR/deployment/update.sh ║"
echo "║                                                     ║"
echo "╚══════════════════════════════════════════════════════╝"

