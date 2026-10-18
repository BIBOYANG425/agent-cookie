"""The one transport every client shares: the base-URL rule, typed errors, Sample marking and the request loop.

Requests are built by the generated client (``agent_cookie_client``: each operation's ``_get_kwargs``), sent here
through one ``httpx.Client`` (no redirects, no cookies, one timeout, never retried) and parsed back into the generated
models (``_parse_response``) only when the answer is 2xx. The workspace decides every release; nothing here widens it.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from http.cookiejar import CookieJar, DefaultCookiePolicy
from types import ModuleType
from typing import Any
from urllib.parse import urlsplit

import httpx

from agent_cookie_client.client import Client
from agent_cookie_client.models.error_body import ErrorBody

DEFAULT_URL = "http://127.0.0.1:4310"
DEFAULT_TIMEOUT_S = 25.0

#: One fixed public sentence per contract error code (the same table as packages/sdk/src/core.ts). A WorkspaceError
#: message is always one of these: never a key, a field value or upstream text.
PUBLIC_MESSAGES: dict[str, str] = {
    "AUTH_REQUIRED": "Workspace authentication is required.",
    "SCOPE_DENIED": "Workspace policy denied this request.",
    "PURPOSE_MISMATCH": "This purpose is not allowed.",
    "GRANT_EXPIRED": "The grant has expired.",
    "GRANT_REVOKED": "The grant was revoked.",
    "NOT_FOUND": "The requested resource is unavailable.",
    "IDEMPOTENCY_CONFLICT": "This operation conflicts with an earlier request.",
    "LINK_NOT_PENDING": "The link was already decided or has expired.",
    "MISSING_FIELD": "A required field is missing.",
    "UPSTREAM_ERROR": "An upstream service could not complete the request.",
    "JAR_LOCKED": "The jar must be unlocked.",
    "AUTHORIZATION_USED": "The payment authorization has already been used.",
    "OVER_BUDGET": "The requested amount exceeds the budget.",
}
#: Every error code the workspace can return (contract ErrorCode).
WORKSPACE_ERROR_CODES: tuple[str, ...] = tuple(PUBLIC_MESSAGES)

UNREACHABLE = "The workspace could not be reached or returned an invalid response."
UNRECOGNIZED = "The workspace rejected the request with an unrecognized error."
INVALID_RESPONSE = "The workspace returned an invalid response."


class AgentCookieError(Exception):
    """Every error this package raises. Messages are fixed sentences: never a key, a URL, a value or upstream text."""


class WorkspaceError(AgentCookieError):
    """A non-2xx workspace answer with a contract code: ``status`` (HTTP) and ``code`` (contract ErrorCode)."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(PUBLIC_MESSAGES.get(code, "The workspace request failed."))
        self.status = status
        self.code = code

    def __repr__(self) -> str:
        return f"WorkspaceError(status={self.status}, code={self.code!r})"


def is_workspace_error(error: object, *codes: str) -> bool:
    """True when ``error`` is a WorkspaceError and (when given) carries one of ``codes``."""
    return isinstance(error, WorkspaceError) and (not codes or error.code in codes)


# ---- where the workspace is ----

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]")
BASE_RULE = (
    "AGENT_COOKIE_URL must be an https:// URL, or http:// on loopback (127.0.0.1, localhost, [::1]), "
    "optionally with a path prefix such as /u/usr_abc (no trailing slash), and no query, fragment or credentials."
)
_SEGMENT = re.compile(r"[A-Za-z0-9._~-]+")
_FORBIDDEN = re.compile(r"[\x00-\x20\x7f%\\?#@]")
_DOT_SEGMENT = re.compile(r"/\.{1,2}(?=/|$)")
_HOST = re.compile(r"[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\]")
_DEFAULT_PORTS = {"http": 80, "https": 443}


def workspace_base(value: str | None) -> str:
    """The base URL of a workspace (the TypeScript SDK's ``workspaceBase`` rule), refused before any key travels.

    ``https://`` on any host, or ``http://`` on loopback only (127.0.0.1, localhost, [::1]). An origin, optionally
    followed by a path prefix of "/"-separated segments of ``[A-Za-z0-9._~-]`` with no trailing slash (a bare origin
    may end in "/"). No query, fragment, credentials, escapes, whitespace or dot segments. Every refusal raises
    ``ValueError`` with the same message. Returns the origin (and prefix), never with a trailing slash.
    """
    raw = (value if value is not None else DEFAULT_URL).strip()
    if not raw or len(raw) > 2048 or _FORBIDDEN.search(raw) or _DOT_SEGMENT.search(raw):
        raise ValueError(BASE_RULE)
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError:
        raise ValueError(BASE_RULE) from None
    scheme = parts.scheme.lower()
    netloc = parts.netloc
    host = netloc.rsplit(":", 1)[0] if not netloc.endswith("]") and ":" in netloc else netloc
    host = host.lower()
    if scheme not in ("http", "https") or not host or not _HOST.fullmatch(host) or not raw.lower().startswith(f"{scheme}://"):
        raise ValueError(BASE_RULE)
    if scheme == "http" and host not in LOOPBACK_HOSTS:
        raise ValueError(BASE_RULE)
    path = parts.path
    prefix = "" if path in ("", "/") else path
    if prefix and not all(_SEGMENT.fullmatch(s) for s in prefix.split("/")[1:]):
        raise ValueError(BASE_RULE)
    origin = f"{scheme}://{host}" + (f":{port}" if port is not None and port != _DEFAULT_PORTS[scheme] else "")
    return origin + prefix


_BEARER = re.compile(r"[\x21-\x7e]{1,512}")


def valid_key(value: object) -> bool:
    """A bearer key as accepted here: printable ASCII without spaces, at most 512 characters."""
    return isinstance(value, str) and _BEARER.fullmatch(value) is not None


def config_from_env(env: Mapping[str, str] | None = None) -> dict[str, Any]:
    """``{"base_url", "key", "sample"}`` from AGENT_COOKIE_URL (default http://127.0.0.1:4310), AGENT_COOKIE_KEY
    (required) and AGENT_COOKIE_SAMPLE (``0`` or ``1``). Pass it to any client: ``WorkspaceClient(**config_from_env())``.
    """
    import os

    source = os.environ if env is None else env
    key = (source.get("AGENT_COOKIE_KEY") or "").strip()
    if not valid_key(key):
        raise ValueError("Set AGENT_COOKIE_KEY in your local environment.")
    base_url = workspace_base(source.get("AGENT_COOKIE_URL"))
    sample = source.get("AGENT_COOKIE_SAMPLE")
    if sample is not None and sample not in ("0", "1"):
        raise ValueError("AGENT_COOKIE_SAMPLE must be 0 or 1.")
    return {"base_url": base_url, "key": key, "sample": sample == "1"}


# ---- input checks (messages never echo the input) ----

_IDEMPOTENCY = re.compile(r"[\x21-\x7e]{1,200}")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def idempotency_key(value: object) -> str:
    if not isinstance(value, str) or not _IDEMPOTENCY.fullmatch(value):
        raise ValueError("Invalid idempotency key.")
    return value


def resource_id(value: object) -> str:
    """A path id: non-empty, at most 256 characters, no control characters, not a dot segment. The generated
    client percent-encodes it into the path."""
    if not isinstance(value, str) or not value.strip() or len(value) > 256 or value in (".", "..") or _CONTROL.search(value):
        raise ValueError("Invalid resource ID.")
    return value


def text(value: object, max_bytes: int) -> bool:
    return isinstance(value, str) and bool(value.strip()) and len(value.encode("utf-8")) <= max_bytes


# ---- Sample marking ----


def has_sample_source(payload: object) -> bool:
    """A payload is Sample when it, its card, or any of its quotes has ``source: sample | fixture``."""

    def sample_source(v: object) -> bool:
        return isinstance(v, dict) and str(v.get("source")) in ("sample", "fixture")

    if not isinstance(payload, dict):
        return False
    quotes = payload.get("quotes")
    return (
        sample_source(payload)
        or sample_source(payload.get("card"))
        or (isinstance(quotes, list) and any(sample_source(q) for q in quotes))
    )


def is_sample(result: object) -> bool:
    """True when a result returned by these clients is Sample data (demo seed, recorded fixtures, or a client
    configured with ``sample=True`` / AGENT_COOKIE_SAMPLE=1). Never show Sample data as a real person or order."""
    extra = getattr(result, "additional_properties", None)
    return isinstance(extra, dict) and extra.get("sample") is True


def _mark_sample(parsed: object) -> None:
    extra = getattr(parsed, "additional_properties", None)
    if isinstance(extra, dict):
        extra["sample"] = True


# ---- transport ----


def _no_cookies() -> httpx.Cookies:
    # A policy that accepts no cookie from any domain: a workspace response can never set one.
    return httpx.Cookies(CookieJar(policy=DefaultCookiePolicy(allowed_domains=[])))


class Transport:
    """One httpx client bound to a validated base URL (and a key, when given). Holds the key privately."""

    def __init__(self, base_url: str, key: str | None = None, *, sample: bool = False, timeout: float = DEFAULT_TIMEOUT_S) -> None:
        base = workspace_base(base_url)
        if key is not None and not valid_key(key):
            raise ValueError("Set AGENT_COOKIE_KEY in your local environment.")
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 0 < timeout <= 120:
            raise ValueError("Workspace timeout must be between 0 and 120 seconds.")
        self.base_url = base
        self.sample = bool(sample)
        headers = {"Accept": "application/json"}
        if key is not None:
            headers["Authorization"] = f"Bearer {key}"
        loopback = urlsplit(base).hostname in ("127.0.0.1", "localhost", "::1")
        self._http = httpx.Client(
            base_url=base,
            headers=headers,
            timeout=httpx.Timeout(timeout),
            follow_redirects=False,  # never forward a credential to a redirect destination
            cookies=_no_cookies(),
            trust_env=not loopback,  # the local workspace is never reached through an environment proxy
        )
        self._client = Client(base_url=base, raise_on_unexpected_status=False).set_httpx_client(self._http)

    def __repr__(self) -> str:
        return f"Transport(base_url={self.base_url!r})"

    def close(self) -> None:
        self._http.close()

    def call(self, op: ModuleType, *args: Any, query_lists: Mapping[str, str] | None = None, **kwargs: Any) -> Any:
        """Build the request with the generated ``op._get_kwargs``, send it, and parse a 2xx answer with
        ``op._parse_response``. ``query_lists`` joins array query parameters with "," (``style: form, explode: false``,
        which the generator does not implement)."""
        request = op._get_kwargs(*args, **kwargs)
        if query_lists:
            params = dict(request.get("params") or {})
            for name in query_lists:
                if isinstance(params.get(name), list):
                    params[name] = ",".join(params[name])
            request["params"] = params
        return self.send(request, lambda response: op._parse_response(client=self._client, response=response))

    def send(self, request: dict[str, Any], parse: Any) -> Any:
        try:
            response = self._http.request(**request)
        except httpx.HTTPError:
            raise AgentCookieError(UNREACHABLE) from None
        if 300 <= response.status_code < 400:
            response.close()
            raise AgentCookieError("Redirect refused.")
        try:
            payload = response.json()
        except ValueError:
            raise AgentCookieError(UNREACHABLE) from None
        if not 200 <= response.status_code < 300:
            raise _rejection(response.status_code, payload)
        try:
            parsed = parse(response)
        except (KeyError, TypeError, ValueError, AttributeError):
            raise AgentCookieError(INVALID_RESPONSE) from None
        if parsed is None or isinstance(parsed, ErrorBody):
            raise AgentCookieError(INVALID_RESPONSE)
        if self.sample or has_sample_source(payload) or (isinstance(payload, dict) and payload.get("sample") is True):
            _mark_sample(parsed)
        return parsed


def _rejection(status: int, payload: object) -> AgentCookieError:
    error = payload.get("error") if isinstance(payload, dict) else None
    code = error.get("code") if isinstance(error, dict) else None
    if isinstance(code, str) and code in PUBLIC_MESSAGES:
        return WorkspaceError(status, code)
    return AgentCookieError(UNRECOGNIZED)
