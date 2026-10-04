#!/usr/bin/env python3
"""Create a named user for one dedicated Airport pilot instance."""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.instance_access import create_user


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a dedicated-instance Airport user")
    parser.add_argument("--base-dir", required=True, type=Path, help="Runtime data directory for this instance")
    parser.add_argument("username", help="Named account (never a shared default account)")
    parser.add_argument("--role", required=True, choices=("viewer", "operator"))
    args = parser.parse_args()

    password = getpass.getpass("Password: ")
    confirmation = getpass.getpass("Repeat password: ")
    if password != confirmation:
        parser.error("Passwords do not match")
    try:
        create_user(args.base_dir, args.username, password, args.role)
    except ValueError as exc:
        parser.error(str(exc))
    print(f"Created {args.role} user {args.username!r} in {args.base_dir.resolve() / 'access.sqlite3'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
