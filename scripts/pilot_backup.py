#!/usr/bin/env python3
"""Offline-only, integrity-checked runtime backup for a dedicated Airport pilot."""

from __future__ import annotations

import argparse
import contextlib
import gzip
import hashlib
import io
import json
import os
import shutil
import sqlite3
import tarfile
import tempfile
import zlib
from pathlib import Path, PurePosixPath
from typing import Any, Iterator, Mapping, Optional

try:
    import fcntl
except ImportError:  # pragma: no cover - the supported pilot host is Linux.
    fcntl = None  # type: ignore[assignment]


class BackupSafetyError(RuntimeError):
    pass


class BackupIntegrityError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _relative_path(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def _is_sqlite(path: Path) -> bool:
    if path.suffix.lower() in {".sqlite", ".sqlite3", ".db"}:
        return True
    with path.open("rb") as handle:
        return handle.read(16) == b"SQLite format 3\x00"


def _is_sqlite_sidecar(path: Path) -> bool:
    for suffix in ("-wal", "-shm"):
        if path.name.endswith(suffix):
            database = path.with_name(path.name[: -len(suffix)])
            return database.is_file() and _is_sqlite(database)
    return False


def _sqlite_copy(source: Path, destination: Path) -> None:
    source_uri = source.resolve().as_uri() + "?mode=ro"
    reader = sqlite3.connect(source_uri, uri=True)
    writer = sqlite3.connect(destination)
    try:
        reader.backup(writer)
        result = writer.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise BackupIntegrityError(f"SQLite integrity check failed for {source.name}: {result}")
    finally:
        writer.close()
        reader.close()


@contextlib.contextmanager
def _maintenance_lock(source: Path) -> Iterator[None]:
    if fcntl is None:
        raise BackupSafetyError("Offline backup lock is unavailable on this platform")
    lock_path = source / ".pilot-backup.lock"
    handle = lock_path.open("a+", encoding="utf-8")
    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise BackupSafetyError("Another pilot maintenance operation holds the offline lock") from exc
        yield
    finally:
        handle.close()


def create_backup(source: Path, archive: Path, *, offline_confirm: bool) -> dict[str, Any]:
    """Create a complete runtime archive only after the operator confirms shutdown."""
    source = Path(source).resolve()
    archive = Path(archive).resolve()
    if not offline_confirm:
        raise BackupSafetyError("Refusing live copy: stop the backend and pass --offline-confirm")
    if not source.is_dir():
        raise BackupSafetyError("Backup source must be an existing runtime directory")
    if archive.exists():
        raise BackupSafetyError("Refusing to overwrite an existing backup archive")
    if archive.is_relative_to(source):
        raise BackupSafetyError("Backup archive must be outside the runtime directory")
    archive.parent.mkdir(parents=True, exist_ok=True)

    with _maintenance_lock(source), tempfile.TemporaryDirectory(prefix="airport-pilot-backup-") as temporary:
        staging = Path(temporary)
        files: list[dict[str, Any]] = []
        for path in sorted(source.rglob("*")):
            if path.name == ".pilot-backup.lock":
                continue
            if _is_sqlite_sidecar(path):
                # The SQLite backup API captures the database atomically; copying
                # a source WAL beside that snapshot would make the restore ambiguous.
                continue
            if path.is_symlink():
                raise BackupSafetyError(f"Refusing symlink in runtime data: {_relative_path(source, path)}")
            if not path.is_file():
                continue
            relative = _relative_path(source, path)
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if _is_sqlite(path):
                _sqlite_copy(path, target)
            else:
                shutil.copy2(path, target)
            files.append({"path": relative, "sha256": _sha256(target), "bytes": target.stat().st_size})

        manifest = {"format": "airport-twin-pilot-backup-v1", "files": files}
        descriptor = os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as archive_file, tarfile.open(
            fileobj=archive_file, mode="w:gz", format=tarfile.PAX_FORMAT,
        ) as output:
            for entry in files:
                output.add(staging / entry["path"], arcname=entry["path"], recursive=False)
            encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
            info = tarfile.TarInfo("manifest.json")
            info.size = len(encoded)
            info.mode = 0o600
            output.addfile(info, io.BytesIO(encoded))
    return manifest


def _safe_name(name: str) -> bool:
    path = PurePosixPath(name)
    return bool(name) and not path.is_absolute() and ".." not in path.parts and path.name not in {"", "."}


def _load_archive(archive: Path) -> tuple[tarfile.TarFile, list[tarfile.TarInfo], dict[str, Any]]:
    try:
        # tarfile can accept a member-complete stream with a truncated gzip footer.
        # Consume it first so a damaged archive cannot pass as a valid backup.
        with gzip.open(archive, "rb") as compressed:
            while compressed.read(1024 * 1024):
                pass
        handle = tarfile.open(archive, "r:gz")
        members = handle.getmembers()
        if any(not member.isfile() or not _safe_name(member.name) for member in members):
            handle.close()
            raise BackupIntegrityError("Archive contains an unsafe path or non-regular file")
        names = [member.name for member in members]
        if len(names) != len(set(names)) or names.count("manifest.json") != 1:
            handle.close()
            raise BackupIntegrityError("Archive manifest is missing or member names are duplicated")
        extracted = handle.extractfile(handle.getmember("manifest.json"))
        if extracted is None:
            handle.close()
            raise BackupIntegrityError("Archive manifest is unreadable")
        manifest = json.loads(extracted.read().decode("utf-8"))
    except (
        OSError,
        EOFError,
        gzip.BadGzipFile,
        json.JSONDecodeError,
        tarfile.TarError,
        UnicodeDecodeError,
        zlib.error,
    ) as exc:
        raise BackupIntegrityError("Archive cannot be read safely") from exc
    if not isinstance(manifest, dict) or manifest.get("format") != "airport-twin-pilot-backup-v1":
        handle.close()
        raise BackupIntegrityError("Archive format is not an Airport pilot backup")
    files = manifest.get("files")
    if not isinstance(files, list):
        handle.close()
        raise BackupIntegrityError("Archive manifest files are invalid")
    manifest_paths = set()
    for entry in files:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str) or not _safe_name(entry["path"]):
            handle.close()
            raise BackupIntegrityError("Archive manifest contains an unsafe path")
        if not isinstance(entry.get("sha256"), str) or len(entry["sha256"]) != 64:
            handle.close()
            raise BackupIntegrityError("Archive manifest checksum is invalid")
        if not isinstance(entry.get("bytes"), int) or entry["bytes"] < 0:
            handle.close()
            raise BackupIntegrityError("Archive manifest size is invalid")
        manifest_paths.add(entry["path"])
    if len(manifest_paths) != len(files) or set(names) != manifest_paths | {"manifest.json"}:
        handle.close()
        raise BackupIntegrityError("Archive members do not match the manifest")
    return handle, members, manifest


def _verify_sqlite(path: Path) -> None:
    if _is_sqlite(path):
        connection = sqlite3.connect(path)
        try:
            result = connection.execute("PRAGMA integrity_check").fetchone()[0]
        finally:
            connection.close()
        if result != "ok":
            raise BackupIntegrityError(f"Restored SQLite integrity check failed for {path.name}: {result}")


def restore_backup(archive: Path, destination: Path) -> None:
    """Restore only a verified archive into a fresh destination path."""
    archive = Path(archive).resolve()
    destination = Path(destination).resolve()
    if not archive.is_file():
        raise BackupSafetyError("Backup archive does not exist")
    if destination.exists():
        raise BackupSafetyError("Restore destination must be a new, non-existing directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle, members, manifest = _load_archive(archive)
    staging: Optional[Path] = Path(tempfile.mkdtemp(prefix="airport-pilot-restore-", dir=destination.parent))
    try:
        expected = {entry["path"]: entry for entry in manifest["files"]}
        for member in members:
            if member.name == "manifest.json":
                continue
            target = staging / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            source = handle.extractfile(member)
            if source is None:
                raise BackupIntegrityError("Archive member is unreadable")
            with target.open("wb") as output:
                shutil.copyfileobj(source, output)
            entry = expected[member.name]
            if target.stat().st_size != entry["bytes"] or _sha256(target) != entry["sha256"]:
                raise BackupIntegrityError(f"Checksum mismatch for {member.name}")
            _verify_sqlite(target)
        os.replace(staging, destination)
        staging = None
    finally:
        handle.close()
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)


def write_test_archive(archive: Path, files: Mapping[str, bytes], checksums: Mapping[str, str]) -> None:
    """Test helper for hostile archive regression tests; not used by the CLI."""
    manifest = {
        "format": "airport-twin-pilot-backup-v1",
        "files": [
            {"path": path, "sha256": digest, "bytes": len(data)}
            for path, data in files.items()
            for digest in [checksums[path]]
        ],
    }
    with tarfile.open(archive, "w:gz") as output:
        for path, data in files.items():
            info = tarfile.TarInfo(path)
            info.size = len(data)
            output.addfile(info, io.BytesIO(data))
        encoded = json.dumps(manifest).encode("utf-8")
        info = tarfile.TarInfo("manifest.json")
        info.size = len(encoded)
        output.addfile(info, io.BytesIO(encoded))


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline Airport Twin pilot backup and restore")
    commands = parser.add_subparsers(dest="command", required=True)
    backup = commands.add_parser("backup", help="Create an offline-only runtime backup")
    backup.add_argument("--source", required=True, type=Path)
    backup.add_argument("--archive", required=True, type=Path)
    backup.add_argument("--offline-confirm", action="store_true", help="Confirms the one backend process is stopped")
    restore = commands.add_parser("restore", help="Restore into a new destination only")
    restore.add_argument("--archive", required=True, type=Path)
    restore.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "backup":
            manifest = create_backup(args.source, args.archive, offline_confirm=args.offline_confirm)
            print(f"Created backup with {len(manifest['files'])} files: {args.archive.resolve()}")
        else:
            restore_backup(args.archive, args.destination)
            print(f"Restored verified backup to {args.destination.resolve()}")
    except (BackupSafetyError, BackupIntegrityError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
