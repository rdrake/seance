"""irctest controller for MrLenin's testnet (nefarious2 with SASL_LOCAL against
Keycloak).  registerUser creates the account as a Keycloak user in realm
$TESTNET_REALM (default testnet) through the admin API at $TESTNET_KC
(default http://127.0.0.1:8080), using the stack's bootstrap admin."""
import json, os, urllib.parse, urllib.request
from typing import Optional, Type

from irctest.controllers.external_server import ExternalServerController

KC = os.environ.get("TESTNET_KC", "http://127.0.0.1:8080")
REALM = os.environ.get("TESTNET_REALM", "testnet")


def _token() -> str:
    body = urllib.parse.urlencode({"grant_type": "password", "client_id": "admin-cli",
                                   "username": os.environ.get("TESTNET_KC_ADMIN", "admin"),
                                   "password": os.environ.get("TESTNET_KC_ADMIN_PASSWORD", "admin")}).encode()
    r = urllib.request.urlopen(KC + "/realms/master/protocol/openid-connect/token", body, timeout=10)
    return json.load(r)["access_token"]


def _req(method: str, path: str, tok: str, data=None):
    req = urllib.request.Request(KC + "/admin/realms/" + REALM + path, method=method,
                                 data=None if data is None else json.dumps(data).encode(),
                                 headers={"Authorization": "Bearer " + tok,
                                          "Content-Type": "application/json"})
    try:
        return urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as e:
        return e


class TestnetController(ExternalServerController):
    software_name = "Nefarious"
    supported_sasl_mechanisms = {"PLAIN"}

    def wait_for_services(self) -> None:
        pass  # Keycloak is up before the run

    def registerUser(self, case, username: str, password: Optional[str] = None) -> None:
        tok = _token()
        q = _req("GET", "/users?exact=true&username=" + urllib.parse.quote(username), tok)
        for u in json.load(q) if q.status == 200 else []:
            _req("DELETE", "/users/" + u["id"], tok)
        user = {"username": username, "enabled": True, "emailVerified": True,
                "email": username + "@example.test", "firstName": username, "lastName": "irctest"}
        if password is not None:
            user["credentials"] = [{"type": "password", "value": password, "temporary": False}]
        r = _req("POST", "/users", tok, user)
        if r.status != 201:
            raise RuntimeError(f"keycloak user {username}: HTTP {r.status}")


def get_irctest_controller_class() -> Type[TestnetController]:
    return TestnetController
