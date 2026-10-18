"""Agent Cookie for Python: ``AssistantClient`` (a company assistant), ``MerchantClient`` (a store's agent) and
``WorkspaceClient`` (the person's own agent, or the owner's console with the owner key), over the client generated
from packages/contract/openapi.json (``agent_cookie_client``). The workspace decides every release; these clients
carry a purpose and a session and raise ``WorkspaceError`` with a fixed message on a refusal."""

from ._core import (
    PUBLIC_MESSAGES,
    WORKSPACE_ERROR_CODES,
    AgentCookieError,
    WorkspaceError,
    config_from_env,
    is_sample,
    is_workspace_error,
    workspace_base,
)
from .clients import (
    LINK_TTL_S,
    QUOTE_POLL_MAX_MS,
    AssistantClient,
    LinkNotApprovedError,
    MerchantClient,
    WorkspaceClient,
    register_agent,
)

__all__ = [
    "LINK_TTL_S",
    "PUBLIC_MESSAGES",
    "QUOTE_POLL_MAX_MS",
    "WORKSPACE_ERROR_CODES",
    "AgentCookieError",
    "AssistantClient",
    "LinkNotApprovedError",
    "MerchantClient",
    "WorkspaceClient",
    "WorkspaceError",
    "config_from_env",
    "is_sample",
    "is_workspace_error",
    "register_agent",
    "workspace_base",
]
