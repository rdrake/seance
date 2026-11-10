"""irctest controller for the nef-spec container (nefarious2 with fake
services, conformance/services_daemon.py).  Accounts are written to the
JSON file the daemon reads ($NEFSPEC_ACCOUNTS)."""
import json, os
from typing import Optional, Type

from irctest.controllers.external_server import ExternalServerController


class NefSpecController(ExternalServerController):
    software_name = "Nefarious"
    supported_sasl_mechanisms = {"PLAIN"}

    def wait_for_services(self) -> None:
        pass  # services_daemon.py is linked before the run

    def registerUser(self, case, username: str, password: Optional[str] = None) -> None:
        path = os.environ["NEFSPEC_ACCOUNTS"]
        try:
            accts = json.load(open(path))
        except (OSError, ValueError):
            accts = {}
        accts[username] = password
        json.dump(accts, open(path, "w"))


def get_irctest_controller_class() -> Type[NefSpecController]:
    return NefSpecController
