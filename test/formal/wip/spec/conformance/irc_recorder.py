"""pytest plugin: record every ClientMock connection's lines, in read order.
Writes one JSON line per connection to $IRC_RECORD: {test, client, events},
events = [["c", line] | ["s", line]] where "s" lines are logged when the
client reads them (logReceivedLine), so a "c" line's position says how many
server lines the client had read before sending it."""
import json, os, pytest
from irctest import client_mock

OUT = os.environ["IRC_RECORD"]
CUR = {"test": None}
LIVE = []

_connect = client_mock.ClientMock.connect
_send = client_mock.ClientMock.sendLine
_recv = client_mock.ClientMock.logReceivedLine


def connect(self, hostname, port):
    self._rec = {"test": CUR["test"], "client": str(self.name), "events": []}
    LIVE.append(self._rec)
    return _connect(self, hostname, port)


def sendLine(self, line):
    r = _send(self, line)
    if hasattr(self, "_rec"):
        l = line.decode(errors="replace") if isinstance(line, bytes) else line
        self._rec["events"].append(["c", l.rstrip("\r\n")])
    return r


def logReceivedLine(self, line):
    if hasattr(self, "_rec"):
        l = line.decode(errors="replace") if isinstance(line, bytes) else line
        self._rec["events"].append(["s", l])
    return _recv(self, line)


client_mock.ClientMock.connect = connect
client_mock.ClientMock.sendLine = sendLine
client_mock.ClientMock.logReceivedLine = logReceivedLine


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item, nextitem):
    CUR["test"] = item.nodeid
    yield
    with open(OUT, "a") as f:
        for r in LIVE:
            f.write(json.dumps(r) + "\n")
    LIVE.clear()


def pytest_runtest_logreport(report):
    if report.when == "call" or (report.when == "setup" and report.outcome != "passed"):
        with open(OUT + ".outcomes", "a") as f:
            f.write(json.dumps({"test": report.nodeid, "when": report.when,
                                "outcome": report.outcome}) + "\n")
