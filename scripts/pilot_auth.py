"""Optional, path-scoped HTTPS Basic Auth for pilot smoke checks."""
import netrc
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


class PilotRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, base):
        self.base = urllib.parse.urlsplit(base)

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urlsplit(newurl)
        prefix = self.base.path.rstrip("/")
        if ((target.scheme, target.netloc) != (self.base.scheme, self.base.netloc)
                or not (target.path == prefix or target.path.startswith(prefix + "/"))):
            raise urllib.error.HTTPError(newurl, code, "Redirect outside authenticated pilot", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def configure_auth(base, auth_file):
    if not auth_file:
        return
    path = Path(auth_file)
    if path.stat().st_mode & 0o077:
        raise ValueError("Credential file must have permissions 0600")
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != "https":
        raise ValueError("Authenticated smoke requires HTTPS")
    credentials = netrc.netrc(str(path)).authenticators(parsed.hostname)
    if not credentials:
        raise ValueError("No credentials for the selected pilot host")
    username, _, password = credentials
    manager = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    manager.add_password(None, base.rstrip("/") + "/", username, password)
    urllib.request.install_opener(urllib.request.build_opener(
        PilotRedirectHandler(base), urllib.request.HTTPBasicAuthHandler(manager),
    ))
