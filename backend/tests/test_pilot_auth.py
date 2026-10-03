from pathlib import Path
import importlib
import urllib.error

import pytest


@pytest.fixture
def auth_module(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "scripts"))
    return importlib.import_module("pilot_auth")


def test_credentials_stay_scoped_to_https_pilot(tmp_path, monkeypatch, auth_module):
    secret = tmp_path / "demo.netrc"
    secret.write_text("machine labpulse.ai login test-user password synthetic-test-password\n")
    secret.chmod(0o600)
    installed = []
    monkeypatch.setattr(auth_module.urllib.request, "install_opener", installed.append)
    auth_module.configure_auth("https://labpulse.ai/airport", str(secret))
    handler = next(h for h in installed[0].handlers if isinstance(h, auth_module.urllib.request.HTTPBasicAuthHandler))
    assert handler.passwd.find_user_password(None, "https://labpulse.ai/airport/api/v1/ready") == ("test-user", "synthetic-test-password")
    assert handler.passwd.find_user_password(None, "https://labpulse.ai/other/") == (None, None)
    redirect = next(h for h in installed[0].handlers if isinstance(h, auth_module.PilotRedirectHandler))
    req = auth_module.urllib.request.Request("https://labpulse.ai/airport/")
    for target in ["https://example.org/airport/", "http://labpulse.ai/airport/", "https://labpulse.ai/other/"]:
        with pytest.raises(urllib.error.HTTPError, match="outside authenticated pilot"):
            redirect.redirect_request(req, None, 302, "redirect", {}, target)


def test_auth_refuses_readable_secret_and_plain_http(tmp_path, auth_module):
    secret = tmp_path / "demo.netrc"
    secret.write_text("machine labpulse.ai login test-user password synthetic-test-password\n")
    secret.chmod(0o644)
    with pytest.raises(ValueError, match="0600"):
        auth_module.configure_auth("https://labpulse.ai/airport", str(secret))
    secret.chmod(0o600)
    with pytest.raises(ValueError, match="HTTPS"):
        auth_module.configure_auth("http://labpulse.ai/airport", str(secret))


def test_local_smoke_without_auth_remains_unchanged(monkeypatch, auth_module):
    monkeypatch.setattr(auth_module.urllib.request, "install_opener", lambda _: pytest.fail("unexpected auth"))
    auth_module.configure_auth("http://localhost:5176", None)
