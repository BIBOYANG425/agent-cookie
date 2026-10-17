#!/usr/bin/env python3
"""Probe upstream locally. --chat is a real model attempt, not an A15/A16 pass."""

import argparse
import ast
import datetime
import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request


def request(url, body=None, headers=None):
    encoded = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=encoded,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return response.status, response.headers.get_content_type(), response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get_content_type(), error.read().decode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clone", default="/tmp/agent-cookie-commerce-agents")
    parser.add_argument("--chat", action="store_true", help="attempt a real chat; may use API credits")
    args = parser.parse_args()
    clone = pathlib.Path(args.clone).resolve()
    report = {"checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "clone": str(clone)}
    exit_code = 0
    try:
        report["upstream_commit"] = subprocess.check_output(
            ["git", "-C", str(clone), "rev-parse", "HEAD"], text=True
        ).strip()
        report["upstream_worktree_clean"] = not subprocess.check_output(
            ["git", "-C", str(clone), "status", "--porcelain"], text=True
        ).strip()
        expected = pathlib.Path(__file__).with_name("upstream-revision").read_text().strip()
        assert report["upstream_commit"] == expected, "Unexpected upstream revision"
        source = (clone / "examples/retail/api/main.py").read_text()
        report["memory_hook"] = {
            "path": "examples/retail/api/main.py",
            "line": next(i for i, line in enumerate(source.splitlines(), 1) if "memory_store=JsonFileMemoryStore" in line),
        }
        tree = ast.parse((clone / "commerce-common/commerce_common/memory.py").read_text())
        protocol = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "MemoryStore")
        report["memory_store_methods"] = [n.name for n in protocol.body if isinstance(n, ast.AsyncFunctionDef)]
        report["node"] = subprocess.check_output(["node", "--version"], text=True).strip()
        report["python"] = subprocess.check_output([str(clone / ".venv/bin/python"), "--version"], text=True).strip()
        code, _, body = request("http://127.0.0.1:8000/api/health")
        report["health"] = {"status": code, "body": json.loads(body)}
        assert code == 200 and report["health"]["body"].get("store") == "ACME", "Retail API not healthy"
        code, kind, body = request("http://127.0.0.1:3000")
        report["storefront"] = {"status": code, "content_type": kind, "contains_acme": "ACME" in body}
        assert code == 200 and kind == "text/html" and report["storefront"]["contains_acme"], "Storefront not serving ACME HTML"
        code, _, body = request("http://127.0.0.1:8000/api/products?limit=1")
        report["products"] = {"status": code, "returned": len(json.loads(body).get("products", []))}
        assert code == 200 and report["products"]["returned"] == 1, "Catalog read failed"
        code, _, body = request("http://127.0.0.1:8000/api/chat", {"message": "Sample verification"})
        report["chat_without_session"] = {"status": code, "body": json.loads(body)}
        assert code == 401, "Chat did not require upstream session header"
        code, _, body = request("http://127.0.0.1:8000/api/session", {"user_id": "sample-blueprint-verification"})
        session = json.loads(body)
        report["session"] = {"status": code, "created": bool(session.get("session_id")), "sample": True}
        assert code == 200 and session.get("session_id"), "Session creation failed"
        if args.chat:
            code, kind, body = request(
                "http://127.0.0.1:8000/api/chat",
                {"message": "Hello. Reply briefly.", "page": {"page_type": "home"}},
                {"X-Session-Id": session["session_id"]},
            )
            events = []
            for frame in body.replace("\r\n", "\n").split("\n\n"):
                lines = frame.splitlines()
                event_type = next((line[7:] for line in lines if line.startswith("event: ")), None)
                data = "\n".join(line[6:] for line in lines if line.startswith("data: "))
                if event_type and data:
                    events.append({"type": event_type, "data": json.loads(data)})
            report["chat"] = {
                "status": code,
                "content_type": kind,
                "event_types": [event.get("type") for event in events],
                "errors": [event.get("data") for event in events if event.get("type") == "error"],
            }
            success = code == 200 and "turn_complete" in report["chat"]["event_types"] and not report["chat"]["errors"]
            report["chat"]["completed"] = success
            if not success:
                exit_code = 2
        else:
            report["chat"] = {"attempted": False}
        report["a15"] = "not verified"
        report["a16"] = "not verified"
    except (AssertionError, OSError, ValueError, StopIteration, subprocess.SubprocessError) as error:
        report["verification_error"] = str(error)
        exit_code = 1
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
