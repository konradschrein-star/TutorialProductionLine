#!/usr/bin/env python3
"""Read-only, credential-redacted reachability check for uploader proxies."""

from __future__ import annotations

import json
import re
import socket
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
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
            parsed = urlsplit(proxy)
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            try:
                with socket.create_connection((parsed.hostname or "", port), timeout=8):
                    pass
            except socket.gaierror:
                print(f"{key}=FAILED:DNS")
                failed = True
                continue
            except (TimeoutError, OSError) as error:
                print(f"{key}=FAILED:TCP:{type(error).__name__}")
                failed = True
                continue
            opener = build_opener(ProxyHandler({"http": proxy, "https": proxy}))
            with opener.open("https://api.ipify.org", timeout=12) as response:
                actual = response.read(128).decode("ascii").strip()
            expected = str(raw.get("expected_egress", "")).strip()
            ok = bool(actual) and (not expected or actual == expected)
            print(f"{key}={'OK' if ok else 'EGRESS_MISMATCH'}")
            failed = failed or not ok
        except HTTPError as error:
            print(f"{key}=FAILED:HTTP:{error.code}")
            failed = True
        except URLError as error:
            reason = str(error.reason)
            status = re.search(r"\b([1-5]\d\d)\b", reason)
            if "tunnel connection failed" in reason.lower():
                detail = f"TUNNEL:{status.group(1) if status else 'UNKNOWN'}"
            elif "timed out" in reason.lower():
                detail = "UPSTREAM_TIMEOUT"
            elif "connection reset" in reason.lower():
                detail = "CONNECTION_RESET"
            else:
                detail = f"URL:{type(error.reason).__name__}"
            print(f"{key}=FAILED:{detail}")
            failed = True
        except Exception as error:
            print(f"{key}=FAILED:{type(error).__name__}")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
