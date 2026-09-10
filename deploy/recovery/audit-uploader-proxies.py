#!/usr/bin/env python3
"""Read-only, credential-redacted reachability check for uploader proxies."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import ProxyHandler, build_opener


def authenticated_proxy(raw: dict[str, object]) -> str:
    server = str(raw.get("server", "")).strip()
    if not server:
        raise ValueError("missing server")
    if "://" not in server:
        server = f"http://{server}"
    parsed = urlsplit(server)
    username = quote(str(raw.get("username", "")), safe="")
    password = quote(str(raw.get("password", "")), safe="")
    auth = f"{username}:{password}@" if username or password else ""
    return urlunsplit((parsed.scheme, f"{auth}{parsed.netloc}", parsed.path, "", ""))


def main() -> int:
    path = Path(sys.argv[1])
    config = json.loads(path.read_text(encoding="utf-8"))
    failed = False
    for key, raw in sorted(config.get("proxies", {}).items()):
        try:
            proxy = authenticated_proxy(raw)
            opener = build_opener(ProxyHandler({"http": proxy, "https": proxy}))
            with opener.open("https://api.ipify.org", timeout=12) as response:
                actual = response.read(128).decode("ascii").strip()
            expected = str(raw.get("expected_egress", "")).strip()
            ok = bool(actual) and (not expected or actual == expected)
            print(f"{key}={'OK' if ok else 'EGRESS_MISMATCH'}")
            failed = failed or not ok
        except Exception as error:
            print(f"{key}=FAILED:{type(error).__name__}")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
