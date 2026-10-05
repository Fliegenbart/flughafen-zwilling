"""Static release guard; live host overlap checks remain mandatory before deploy."""

from ipaddress import ip_network
from pathlib import Path

import yaml


def test_hetzner_proxy_network_contract():
    root = Path(__file__).resolve().parents[2]
    config = yaml.safe_load((root / "docker-compose.hetzner.yml").read_text())
    network = config["networks"]["simulation"]
    subnet = network["ipam"]["config"][0]["subnet"]
    assert subnet == "10.253.250.0/24"
    assert not ip_network(subnet).overlaps(ip_network("172.31.0.0/16"))
    assert network["internal"] is True
    backend = config["services"]["twin-core"]
    command = backend["command"]
    assert command[command.index("--forwarded-allow-ips") + 1] == subnet
    assert "--proxy-headers" in command
    assert command[command.index("--workers") + 1] == "1"
    assert config["name"] == "airport-twin-pilot"
    assert not backend.get("ports")
    assert backend["environment"]["INFLUX_TOKEN"] == ""
    for document in ("HETZNER_PILOT.md", "PILOT_OPERATIONS.md"):
        assert subnet in (root / "docs" / document).read_text()
