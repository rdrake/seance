#!/bin/sh
# Local nefarious2 for the chathistory conformance harness. Never AfterNET.
#
#   CONFTEST_PASSWORD=... tools/nef2-conformance/run.sh   # detached
#   docker logs -f nef2-conformance
#
# Ports (127.0.0.1 only): 16667 plain IRC, 18067 ws://.
# Account: conftest, SASL PLAIN through iauthd-ts (no services). The password
# comes from $CONFTEST_PASSWORD, else from state/test-password.txt (made with
# a random value on first run). Both stay out of git: state/ is gitignored.
set -e
cd "$(dirname "$0")"
D=$(pwd)
STATE="$D/state"
mkdir -p "$STATE"
if [ -z "$CONFTEST_PASSWORD" ]; then
	[ -f "$STATE/test-password.txt" ] || (umask 077; openssl rand -hex 12 >"$STATE/test-password.txt")
	CONFTEST_PASSWORD=$(cat "$STATE/test-password.txt")
fi
# The SASLDB file: a plain-text password.
(umask 022; printf 'conftest:%s\n' "$CONFTEST_PASSWORD" >"$STATE/saslusers")
docker rm -f nef2-conformance >/dev/null 2>&1 || true
exec docker run -d --name nef2-conformance \
	-p 127.0.0.1:16667:6667 -p 127.0.0.1:18067:8067 \
	-e IRCD_GENERAL_NAME=irc.conformance.test \
	-e IRCD_GENERAL_DESCRIPTION="Conformance dev" \
	-e IRCD_GENERAL_NUMERIC=1 \
	-e IRCD_ADMIN_LOCATION="localhost" \
	-e IRCD_ADMIN_CONTACT="localhost" \
	-v "$D/ircd.conf:/home/nefarious/ircd/ircd.conf:ro" \
	-v "$D/local.conf:/home/nefarious/ircd/local.conf:ro" \
	-v "$STATE/saslusers:/home/nefarious/ircd/saslusers:ro" \
	"${NEFARIOUS_IMAGE:-nefarious2:ircv3}"
