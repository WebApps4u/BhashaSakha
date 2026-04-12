#!/bin/bash
# Generate a self-signed SSL certificate for local HTTPS testing
# This permanently fixes "Mic Access Denied" errors when accessing over LAN.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Generating local self-signed SSL certificates..."

openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$ROOT_DIR/key.pem" \
    -out "$ROOT_DIR/cert.pem" \
    -subj "/C=IN/ST=Maharastra/L=Mumbai/O=BhashaSakha/CN=0.0.0.0"

echo "cert.pem and key.pem generated in $ROOT_DIR."
echo "BhashaSakha will now start securely over HTTPS! (https://0.0.0.0:8080)"
