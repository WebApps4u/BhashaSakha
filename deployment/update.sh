#!/bin/bash
# deployment/update.sh — Safe OTA update for BhashaSakha
#
# Usage: sudo bash deployment/update.sh [git-repo-url]
#
# Features:
# - Downloads new code to staging directory
# - Validates with quick benchmark before swapping
# - Atomic directory swap
# - Auto-rollback on failure

set -euo pipefail

APP_DIR="/opt/bhashasakha"
STAGING="/opt/bhashasakha-staging"
BACKUP="/opt/bhashasakha-backup"
SERVICE="bhashasakha"

echo "╔══════════════════════════════════════╗"
echo "║  BhashaSakha OTA Update              ║"
echo "╚══════════════════════════════════════╝"

# === Step 1: Download new code ===
REPO_URL="${1:-}"
if [ -z "$REPO_URL" ]; then
    echo "Usage: sudo bash update.sh <git-repo-url>"
    echo "  or copy new code to $STAGING manually"
    exit 1
fi

echo "[1/6] Downloading new code..."
rm -rf "$STAGING"
git clone --depth 1 "$REPO_URL" "$STAGING"

# === Step 2: Check model compatibility ===
echo "[2/6] Checking models..."
if [ -f "$STAGING/models/checksums.sha256" ] && [ -f "$APP_DIR/models/checksums.sha256" ]; then
    if diff -q "$STAGING/models/checksums.sha256" "$APP_DIR/models/checksums.sha256" >/dev/null 2>&1; then
        echo "  Models unchanged — reusing existing models"
        rm -rf "$STAGING/models"
        ln -s "$APP_DIR/models" "$STAGING/models"
    else
        echo "  Models changed — downloading new models..."
        bash "$STAGING/scripts/download_models.sh"
    fi
else
    echo "  No checksum file — reusing existing models"
    rm -rf "$STAGING/models"
    cp -r "$APP_DIR/models" "$STAGING/models"
fi

# === Step 3: Install dependencies ===
echo "[3/6] Installing dependencies..."
"$APP_DIR/venv/bin/pip" install -r "$STAGING/requirements.txt" --quiet

# === Step 4: Quick validation ===
echo "[4/6] Running quick validation..."
"$APP_DIR/venv/bin/python" "$STAGING/scripts/benchmark.py" --mode quick 2>/dev/null
BENCH_EXIT=$?

if [ $BENCH_EXIT -ne 0 ]; then
    echo "  ✗ VALIDATION FAILED — aborting update"
    rm -rf "$STAGING"
    exit 1
fi
echo "  ✓ Validation passed"

# === Step 5: Atomic swap ===
echo "[5/6] Swapping directories..."
sudo systemctl stop "$SERVICE"

# Backup current
rm -rf "$BACKUP"
mv "$APP_DIR" "$BACKUP"

# Install new
mv "$STAGING" "$APP_DIR"

# Preserve models from backup if symlinked
if [ -L "$APP_DIR/models" ]; then
    rm "$APP_DIR/models"
    cp -r "$BACKUP/models" "$APP_DIR/models"
fi

# Preserve logs
if [ -d "$BACKUP/logs" ]; then
    cp -r "$BACKUP/logs" "$APP_DIR/logs"
fi

# Fix ownership
chown -R bhashasakha:bhashasakha "$APP_DIR"

# === Step 6: Restart and verify ===
echo "[6/6] Restarting service..."
sudo systemctl daemon-reload
sudo systemctl start "$SERVICE"

sleep 10

if sudo systemctl is-active --quiet "$SERVICE"; then
    echo ""
    echo "╔══════════════════════════════════════╗"
    echo "║  ✓ UPDATE SUCCESSFUL                 ║"
    echo "╚══════════════════════════════════════╝"
    echo ""
    echo "Cleaning up backup..."
    rm -rf "$BACKUP"
else
    echo ""
    echo "╔══════════════════════════════════════╗"
    echo "║  ✗ UPDATE FAILED — ROLLING BACK      ║"
    echo "╚══════════════════════════════════════╝"
    echo ""
    mv "$APP_DIR" "/opt/bhashasakha-failed"
    mv "$BACKUP" "$APP_DIR"
    sudo systemctl start "$SERVICE"
    echo "Rolled back to previous version"
    exit 1
fi
