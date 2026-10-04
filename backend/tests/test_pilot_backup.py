from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

import pytest


def _backup_module():
    path = Path(__file__).resolve().parents[2] / "scripts" / "pilot_backup.py"
    spec = importlib.util.spec_from_file_location("pilot_backup", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _runtime(source: Path) -> None:
    (source / "runs").mkdir(parents=True)
    (source / "runs" / "record.json").write_text('{"state":"completed"}', encoding="utf-8")
    connection = sqlite3.connect(source / "access.sqlite3")
    connection.execute("CREATE TABLE users (username TEXT PRIMARY KEY)")
    connection.execute("INSERT INTO users VALUES ('operator')")
    connection.commit()
    connection.close()


def test_backup_and_restore_preserve_runtime_and_sqlite_integrity(tmp_path) -> None:
    backup = _backup_module()
    source = tmp_path / "runtime"
    source.mkdir()
    _runtime(source)
    archive = tmp_path / "pilot.tar.gz"
    destination = tmp_path / "restored"

    manifest = backup.create_backup(source, archive, offline_confirm=True)
    assert archive.stat().st_mode & 0o777 == 0o600
    backup.restore_backup(archive, destination)

    assert manifest["format"] == "airport-twin-pilot-backup-v1"
    assert (destination / "runs" / "record.json").read_text(encoding="utf-8") == '{"state":"completed"}'
    connection = sqlite3.connect(destination / "access.sqlite3")
    assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert connection.execute("SELECT username FROM users").fetchone()[0] == "operator"
    connection.close()


def test_backup_refuses_without_explicit_offline_confirmation(tmp_path) -> None:
    backup = _backup_module()
    source = tmp_path / "runtime"
    source.mkdir()

    with pytest.raises(backup.BackupSafetyError):
        backup.create_backup(source, tmp_path / "pilot.tar.gz", offline_confirm=False)


def test_restore_rejects_corrupt_archive_and_existing_destination(tmp_path) -> None:
    backup = _backup_module()
    source = tmp_path / "runtime"
    source.mkdir()
    _runtime(source)
    archive = tmp_path / "pilot.tar.gz"
    backup.create_backup(source, archive, offline_confirm=True)
    archive.write_bytes(archive.read_bytes()[:-16])

    with pytest.raises(backup.BackupIntegrityError):
        backup.restore_backup(archive, tmp_path / "restored")

    existing = tmp_path / "existing"
    existing.mkdir()
    with pytest.raises(backup.BackupSafetyError):
        backup.restore_backup(archive, existing)


def test_restore_rejects_path_traversal_member(tmp_path) -> None:
    backup = _backup_module()
    archive = tmp_path / "traversal.tar.gz"
    backup.write_test_archive(
        archive,
        {"../escape.txt": b"nope"},
        {"../escape.txt": "ignored"},
    )

    with pytest.raises(backup.BackupIntegrityError):
        backup.restore_backup(archive, tmp_path / "restored")
