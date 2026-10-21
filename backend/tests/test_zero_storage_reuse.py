"""No-storage variants have identical physical inputs and may share a grid scan."""
import pytest

from app.exchange import electrification


@pytest.mark.parametrize("share", [0, 50, 100])
def test_no_storage_has_identical_managed_world_and_policy(share):
    request = electrification.ElectrificationRequest(
        electric_share_pct=share, storage_kwh=0, grid_import_limit_kw=1225)
    _, config_a, policy_a, world_a, _ = electrification.prepare_electrification(request, "managed")
    _, config_b, policy_b, world_b, _ = electrification.prepare_electrification(
        request, "managed_storage")
    assert config_a == config_b
    assert policy_a == policy_b
    assert world_a == world_b


def test_no_storage_reuses_only_identical_managed_scan(monkeypatch):
    calls = []

    def scan(*args, **kwargs):
        result = {"scan": len(calls)}
        calls.append(result)
        return result

    electrification._size_solutions.cache_clear()
    monkeypatch.setattr(electrification, "atlas_sizes", lambda *args: None)  # Live-Pfad
    monkeypatch.setattr(electrification, "_resource_baseline_feasible", lambda airport=None: True)
    monkeypatch.setattr(electrification, "search_connection", scan)
    try:
        result = electrification._size_solutions(100, 0)
        assert len(calls) == 2
        assert result["managed_storage"] == result["managed"]
        assert result["direct"] != result["managed"]
    finally:
        electrification._size_solutions.cache_clear()
