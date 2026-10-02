#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

check_snapshot() {
  (
    cd "$repo_dir/$1"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum -c SHA256SUMS >/dev/null
    else
      shasum -a 256 -c SHA256SUMS >/dev/null
    fi
  )
}

check_snapshot legacy/ems_baseline
check_snapshot legacy/airport_grafana
printf '%s\n' 'Original-Snapshots intakt: EMS-Grundlage und Airport-Dashboard.'
