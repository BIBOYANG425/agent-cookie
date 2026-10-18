"""A REAL demo workspace for the integration tests, started like apps/workspace/test/acceptance/helpers.ts
startWorkspace does: ``tsx src/server.ts`` in apps/workspace, in-memory SQLite, the Sample seed (<repo>/fixtures), a
fresh git memory repo in a temp dir and recorded UCP answers (AGENT_COOKIE_UCP=fixture). Keys come from
fixtures/dev-keys.json by role and are never printed."""

from __future__ import annotations

import json
import os
import shutil
import signal
import socket
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest

REPO = Path(__file__).resolve().parents[3]
WORKSPACE_DIR = REPO / "apps" / "workspace"
FIXTURES = REPO / "fixtures"
TSX = WORKSPACE_DIR / "node_modules" / ".bin" / "tsx"
_DROP = ("AGENT_COOKIE_", "UCP_", "VITEST", "CALLBACK_")
_DROP_EXACT = {"MEMORY_REPO_PATH", "SQLITE_PATH", "FIXTURES_DIR", "PORT"}


def fixture(rel: str):
    return json.loads((FIXTURES / rel).read_text("utf-8"))


def dev_key(agent_id: str, role: str) -> str:
    for key, who in fixture("dev-keys.json").items():
        if who["agentId"] == agent_id and who["role"] == role:
            return key
    raise LookupError("fixtures/dev-keys.json has no such entry")


@dataclass
class Workspace:
    url: str
    owner_key: str
    personal_key: str


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def workspace():
    if not TSX.exists():
        pytest.skip("apps/workspace/node_modules/.bin/tsx not found: run pnpm install at the repository root")
    port = _free_port()
    tmp = Path(tempfile.mkdtemp(prefix="agent-cookie-sdk-python-"))
    env = {k: v for k, v in os.environ.items() if not k.startswith(_DROP) and k not in _DROP_EXACT}
    env.update(
        PORT=str(port),
        SQLITE_PATH=":memory:",
        FIXTURES_DIR=str(FIXTURES),
        MEMORY_REPO_PATH=str(tmp / "memory"),
        AGENT_COOKIE_DEMO="1",
        AGENT_COOKIE_UCP="fixture",
        AGENT_COOKIE_TEST="1",
        CALLBACK_TIMEOUT_MS="1000",
        CALLBACK_RETRIES="1",
    )
    log = open(tmp / "workspace.log", "wb")
    proc = subprocess.Popen(
        [str(TSX), "src/server.ts"], cwd=WORKSPACE_DIR, env=env, stdout=log, stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL, start_new_session=True,
    )

    def stop() -> None:
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=5)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.wait(timeout=5)
        log.close()
        shutil.rmtree(tmp, ignore_errors=True)

    url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 30
    try:
        while True:
            if proc.poll() is not None:
                raise RuntimeError("workspace exited before answering:\n" + (tmp / "workspace.log").read_text("utf-8", "replace")[-4000:])
            try:
                status = httpx.get(f"{url}/me", timeout=1, trust_env=False).status_code
                if status == 401:
                    break
                raise RuntimeError(f"GET /me without a key answered {status}, expected 401")
            except httpx.HTTPError:
                pass
            if time.monotonic() > deadline:
                raise RuntimeError("workspace did not answer GET /me with 401 within 30 s:\n"
                                   + (tmp / "workspace.log").read_text("utf-8", "replace")[-4000:])
            time.sleep(0.15)
    except BaseException:
        stop()
        raise
    yield Workspace(url=url, owner_key=dev_key("owner", "owner"), personal_key=dev_key("sample-personal-photon", "personal"))
    stop()
