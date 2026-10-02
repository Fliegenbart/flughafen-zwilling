#!/bin/sh
set -eu
data_dir="${TWIN_DATA_DIR:-/app/data}"
for kind in scenarios model_packs; do
  mkdir -p "$data_dir/$kind"
  for source in /opt/airport-seeds/"$kind"/*.json; do
    target="$data_dir/$kind/$(basename "$source")"
    # Preserve persisted edits and recovered jobs on a container restart.
    if [ ! -f "$target" ]; then cp "$source" "$target"; fi
  done
done
exec "$@"
