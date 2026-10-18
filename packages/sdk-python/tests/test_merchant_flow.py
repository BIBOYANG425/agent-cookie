"""A store's agent through the Python SDK against the real demo workspace: introduced by an intent's kind, it reads
the handshake and auto fields of its pairwise session, is refused payment_method, quotes, and keeps its own note."""

from __future__ import annotations

import pytest

from agent_cookie import MerchantClient, WorkspaceClient, WorkspaceError, register_agent


def test_merchant_handshake_fields_quote_note_stats(workspace):
    owner = WorkspaceClient(workspace.url, workspace.owner_key)
    personal = WorkspaceClient(workspace.url, workspace.personal_key)
    owner.demo_reset()

    reg = register_agent(workspace.url, "Trail Store · Sample", "shoe", capabilities=["trail_shoes"],
                         callback_url="http://127.0.0.1:9/agent-cookie")
    store = MerchantClient(workspace.url, reg.key)
    created = personal.create_intent("Sample · trail shoes, EU 42", "py-merchant-0001", kind="trail_shoes")
    grant = next(g for g in personal.get_grants().grants if g.agent_id == reg.agent_id)
    session_id = grant.session_id

    hello = store.handshake(session_id)
    assert hello.session_id == session_id and hello.lang == "zh"
    assert "shoe_size" in [str(f) for f in hello.available]

    read = store.fields(session_id, ["lang", "shoe_size"])
    assert read.fields.to_dict() == {"lang": "zh", "shoe_size": "42"}

    with pytest.raises(WorkspaceError) as denied:
        store.fields(session_id, ["payment_method"], "payment")
    assert (denied.value.status, denied.value.code) == (403, "SCOPE_DENIED")
    with pytest.raises(WorkspaceError) as early:
        store.fields(session_id, ["shipping_address"], "checkout")
    assert early.value.code in ("PURPOSE_MISMATCH", "SCOPE_DENIED")

    quote = store.quote(created.intent_id, "Sample · Trail shoe, EU 42", 11995, f"quote-{created.intent_id}")
    assert quote.intent_id == created.intent_id and quote.price == 11995
    assert store.quote(created.intent_id, "Sample · Trail shoe, EU 42", 11995, f"quote-{created.intent_id}").id == quote.id

    store.set_note(session_id, "fit", "Sample: prefers a wide toe box")
    assert store.get_note(session_id, "fit").value == "Sample: prefers a wide toe box"
    with pytest.raises(WorkspaceError) as missing:
        store.get_note(session_id, "absent")
    assert missing.value.code == "NOT_FOUND"

    assert store.stats().quotes >= 1
