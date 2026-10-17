#!/usr/bin/env python3
"""Exercise original upstream HTTP/session isolation; never claims A08 or LLM success."""

import argparse
import datetime
import json
import sys
import urllib.error
import urllib.request
import uuid

if __package__:
    from .http_probe import open_direct
else:
    from http_probe import open_direct


def call(url, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Session-Id"] = token
    request = urllib.request.Request(url, headers=headers, data=None if body is None else json.dumps(body).encode())
    try:
        with open_direct(request, timeout=15) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        if 300 <= error.code < 400:
            error.close()
            raise RuntimeError(f"Probe redirects are refused (HTTP {error.code})") from None
        with error:
            return error.code, error.read().decode()


def smoke(api_ports, web_ports):
    result = {"checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "mode": "bootstrap_only", "workspace_connected": False, "llm_tested": False,
              "a08": "not tested", "pairwise_ids": "awaiting frozen workspace contract", "instances": []}
    tokens = []
    subject = f"sample-dual-{uuid.uuid4().hex[:12]}"
    for name, api, web in zip("ab", api_ports, web_ports):
        base = f"http://127.0.0.1:{api}"
        code, body = call(f"{base}/api/health")
        health = json.loads(body)
        if code != 200 or health.get("store") != "ACME":
            raise RuntimeError(f"{name}: retail health failed")
        web_code, html = call(f"http://127.0.0.1:{web}/")
        if web_code != 200 or "ACME" not in html:
            raise RuntimeError(f"{name}: storefront HTML failed")
        catalog_code, catalog = call(f"{base}/api/products?limit=1")
        if catalog_code != 200 or len(json.loads(catalog).get("products", [])) != 1:
            raise RuntimeError(f"{name}: catalog failed")
        session_code, session_body = call(f"{base}/api/session", {"user_id": subject})
        session = json.loads(session_body)
        if session_code != 200 or not session.get("session_id"):
            raise RuntimeError(f"{name}: session creation failed")
        tokens.append(session["session_id"])
        result["instances"].append({"name": name, "api_port": api, "web_port": web, "health": code,
            "storefront": web_code, "catalog": catalog_code, "session_created": True, "sample_subject": True})
    if tokens[0] == tokens[1]:
        raise RuntimeError("Two instances returned the same upstream session token")
    for i, api in enumerate(api_ports):
        own, _ = call(f"http://127.0.0.1:{api}/api/memory", token=tokens[i])
        other, _ = call(f"http://127.0.0.1:{api}/api/memory", token=tokens[1-i])
        if own != 200 or other != 401:
            raise RuntimeError(f"{'ab'[i]}: upstream session boundary failed")
        result["instances"][i].update(own_session=own, other_instance_session=other)
    result["passed"] = True
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-a", type=int, default=8000)
    parser.add_argument("--api-b", type=int, default=8001)
    parser.add_argument("--web-a", type=int, default=3000)
    parser.add_argument("--web-b", type=int, default=3001)
    args = parser.parse_args()
    try:
        print(json.dumps(smoke([args.api_a, args.api_b], [args.web_a, args.web_b]), indent=2))
    except (OSError, ValueError, RuntimeError) as error:
        print(json.dumps({"passed": False, "mode": "bootstrap_only", "error": str(error)}))
        sys.exit(1)
