#!/usr/bin/env python3
"""Start two isolated upstream storefronts. Bootstrap only: no workspace integration."""

import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error

if __package__:
    from .http_probe import open_direct
else:
    from http_probe import open_direct


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
REVISION = (HERE.parent / "upstream-revision").read_text().strip()
SAFE_ENV = ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR")
INSTANCE_ENV = {"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "AGENT_COOKIE_KEY", "AGENT_COOKIE_URL"}


def credentials(path):
    if path is None:
        return {}
    values = {}
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, sep, raw = line.partition("=")
        name = name.strip()
        if not sep or name not in INSTANCE_ENV or name in values:
            raise ValueError(f"Invalid or duplicate environment name at {path}:{number}")
        try:
            tokens = shlex.split(raw, comments=True, posix=True)
        except ValueError:
            raise ValueError(f"Invalid quoted value at {path}:{number}") from None
        if len(tokens) > 1:
            raise ValueError(f"Quote values containing spaces at {path}:{number}")
        values[name] = tokens[0] if tokens else ""
    return values


def child_environment(values, *, frontend=False, api_port=None):
    # Start from an allowlist: parent/sibling key variables and PYTHONPATH never leak in.
    env = {name: os.environ[name] for name in SAFE_ENV if name in os.environ}
    env.update(PYTHONNOUSERSITE="1", DEMO_LOG_LEVEL="INFO", NEXT_TELEMETRY_DISABLED="1")
    if frontend:
        env["NEXT_PUBLIC_API_URL"] = f"http://127.0.0.1:{api_port}"
    else:
        env.update(values)
    return env


def validate_layout(clones, ports, env_paths):
    if clones[0] == clones[1] or clones[0] in clones[1].parents or clones[1] in clones[0].parents:
        raise ValueError("Clone directories must be distinct and must not contain each other")
    if len(set(ports)) != 4 or any(p < 1024 or p > 65535 for p in ports):
        raise ValueError("All four ports must be distinct and between 1024 and 65535")
    if env_paths[0] and env_paths[1] and env_paths[0] == env_paths[1]:
        raise ValueError("Instances must use separate environment files")
    if any(path and (path == PROJECT or PROJECT in path.parents) for path in env_paths):
        raise ValueError("Environment files containing credentials must stay outside the repository")
    for clone in clones:
        if clone == PROJECT or PROJECT in clone.parents:
            raise ValueError("Upstream clones must stay outside the Agent Cookie repository")
        for relative in (".venv", "examples/retail/data", "examples/retail/data/.memory-store.json"):
            target = (clone / relative).resolve()
            if clone not in target.parents:
                raise ValueError(f"Shared or external writable path is not allowed: {clone / relative}")
        # Both upstream dotenv and Next.js can load files after we build the environment.
        for directory in (clone, clone / "examples/retail", clone / "examples/retail/storefront-web"):
            unexpected = [p for p in directory.glob(".env*") if p.name != ".env.example"]
            if unexpected:
                raise ValueError(f"Implicit dotenv files are not allowed in {directory}; use --env-a/--env-b")
    for relative in ("examples/retail/data/.memory-store.json", "examples/retail/data/.memory-seeded.json"):
        a, b = (clone / relative for clone in clones)
        if a.exists() and b.exists() and os.path.samefile(a, b):
            raise ValueError("Instances share a writable memory file")


def check_ports(ports):
    held = []
    try:
        for port in ports:
            connection = socket.socket()
            held.append(connection)
            try:
                connection.bind(("127.0.0.1", port))
            except OSError:
                raise ValueError(f"Port {port} is occupied; no server will be reused or moved") from None
    finally:
        for connection in held:
            connection.close()


def validate_keys(values):
    keys = [value.get("AGENT_COOKIE_KEY") for value in values]
    if bool(keys[0]) != bool(keys[1]) or (keys[0] and keys[0] == keys[1]):
        raise ValueError("Configure distinct workspace keys for both APIs, or omit both for bootstrap")
    return keys


def inspect_clone(clone, node):
    if subprocess.check_output(["git", "-C", str(clone), "rev-parse", "HEAD"], text=True).strip() != REVISION:
        raise ValueError(f"Unexpected upstream revision in {clone}")
    if subprocess.run(["git", "-C", str(clone), "diff", "--quiet", "HEAD"]).returncode:
        raise ValueError(f"Tracked upstream files have changed in {clone}")
    python = clone / ".venv/bin/python"
    next_js = clone / "examples/node_modules/next/dist/bin/next"
    if not python.is_file() or not next_js.is_file():
        raise ValueError(f"Run setup.sh for {clone} first")
    # Editable installs can silently point B's imports at A. Inspect actual import origins.
    probe = """
import json, sys
import commerce_common, shopping_agent, shopping_agent_runtime, demo_common
from retail.api.mock_retail import DATA_DIR
print(json.dumps({'prefix':sys.prefix, 'data':str(DATA_DIR), 'modules':[
commerce_common.__file__,shopping_agent.__file__,shopping_agent_runtime.__file__,demo_common.__file__]}))
"""
    env = child_environment({})
    env["PYTHONPATH"] = str(clone / "examples")
    resolved = json.loads(subprocess.check_output([str(python), "-c", probe], cwd=clone, env=env, text=True))
    if Path(resolved["prefix"]).resolve() != clone / ".venv":
        raise ValueError(f"Virtual environment does not belong to {clone}")
    if Path(resolved["data"]).resolve() != clone / "examples/retail/data":
        raise ValueError(f"Retail DATA_DIR does not belong to {clone}")
    if any(clone not in Path(path).resolve().parents for path in resolved["modules"]):
        raise ValueError(f"An editable module resolves outside {clone}")
    native = subprocess.run([node, "-e", "require('lightningcss'); require('@tailwindcss/oxide')"],
                            cwd=clone / "examples", env=child_environment({}, frontend=True, api_port=8000),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if native.returncode:
        raise ValueError(f"Web native dependencies cannot load in {clone}; rerun npm ci --include=optional in its examples directory")
    return python, next_js


def stream_logs(process, label):
    for line in process.stdout:
        print(f"[{label}] {line.rstrip()}", flush=True)


def await_ready(url, process, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Process exited before {url} became ready")
        try:
            with open_direct(url, timeout=2) as response:
                if response.status == 200:
                    return
        except urllib.error.HTTPError as error:
            error.close()
            raise RuntimeError(f"Startup readiness returned HTTP {error.code} at {url}") from None
        except OSError:
            pass
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for {url}")


def run(args):
    clones = [Path(args.clone_a).resolve(), Path(args.clone_b).resolve()]
    env_paths = [Path(p).resolve() if p else None for p in (args.env_a, args.env_b)]
    ports = [args.api_a, args.web_a, args.api_b, args.web_b]
    validate_layout(clones, ports, env_paths)
    values = [credentials(path) for path in env_paths]
    keys = validate_keys(values)
    node = shutil.which("node")
    node_version = subprocess.check_output([node, "--version"], text=True).strip() if node else "missing"
    if node_version.split(".")[0] != "v22":
        raise ValueError("Node 22 is required; put its bin directory first in PATH")
    runtimes = [inspect_clone(clone, node) for clone in clones]
    check_ports(ports)
    print(json.dumps({"mode": "bootstrap_only", "workspace_connected": False, "upstream": REVISION, "node": node_version,
        "instances": [{"name": name, "clone": str(clone), "api": ports[i*2], "web": ports[i*2+1],
                       "python_environment": str(clone / ".venv"), "data_dir": str(clone / "examples/retail/data"),
                       "memory_file": str(clone / "examples/retail/data/.memory-store.json"),
                       "workspace_key_configured": bool(keys[i])} for i, (name, clone) in enumerate(zip("ab", clones))]}, indent=2), flush=True)
    if args.check:
        return 0
    processes = []
    try:
        for i, (clone, (python, next_js)) in enumerate(zip(clones, runtimes)):
            api_port, web_port = ports[i*2:i*2+2]
            specs = [
                ([str(python), "-m", "uvicorn", "retail.api.main:app", "--app-dir", str(clone / "examples"),
                  "--host", "127.0.0.1", "--port", str(api_port)], clone, child_environment(values[i]), "api", f"http://127.0.0.1:{api_port}/api/health"),
                ([node, str(next_js), "dev", "--hostname", "127.0.0.1", "--port", str(web_port)],
                 clone / "examples/retail/storefront-web", child_environment({}, frontend=True, api_port=api_port), "storefront", f"http://127.0.0.1:{web_port}/"),
            ]
            for command, cwd, env, kind, url in specs:
                process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                           stderr=subprocess.STDOUT, text=True, start_new_session=True)
                processes.append(process)
                threading.Thread(target=stream_logs, args=(process, f"{'ab'[i]}-{kind}"), daemon=True).start()
                await_ready(url, process)
        print("Both Sample storefronts are ready. Bootstrap only; no Agent Cookie calls or LLM pass claimed.", flush=True)
        while all(process.poll() is None for process in processes):
            time.sleep(0.5)
        raise RuntimeError("A child exited; stopping both instances")
    finally:
        for process in processes:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()


def interrupt(*_):
    raise KeyboardInterrupt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clone-a", default="/tmp/agent-cookie-commerce-agents")
    parser.add_argument("--clone-b", default="/tmp/agent-cookie-commerce-agents-b")
    parser.add_argument("--env-a", type=str)
    parser.add_argument("--env-b", type=str)
    for name, default in (("api-a", 8000), ("web-a", 3000), ("api-b", 8001), ("web-b", 3001)):
        parser.add_argument(f"--{name}", type=int, default=default)
    parser.add_argument("--check", action="store_true", help="validate isolation and ports without starting")
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, interrupt)
    try:
        return run(args)
    except KeyboardInterrupt:
        print("Dual storefronts stopped; external clones and data retained.")
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Cannot start dual storefronts: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
