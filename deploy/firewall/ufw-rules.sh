#!/usr/bin/env bash
set -euo pipefail

# Harden host: only SSH + HTTPS inbound.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 443/tcp

# Do not expose app port directly.
ufw deny 8000/tcp

ufw --force enable
ufw status verbose
