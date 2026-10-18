"""The assistant flow of apps/workspace/test/acceptance/a31-assistant.test.ts, through the Python SDK against a real
demo workspace (Sample persona, recorded UCP answers)."""

from __future__ import annotations

import json

import pytest

from agent_cookie import (
    AssistantClient,
    WorkspaceClient,
    WorkspaceError,
    is_sample,
    register_agent,
)

from .conftest import fixture

PINNED = fixture("ucp/pinned.json")
# The recording's own parameters as an intent (EU 42 / $120), exactly as helpers.ts PINNED.intent.
PINNED_TEXT = "找一双越野跑鞋 · Sample"
PINNED_PUBLIC = {"budget": str(PINNED["budget"]), "shoe_size": PINNED["size"]}
ADDRESS_NEEDLES = ["Example Lane", "Sample Recipient", "90024"]


def no_secrets(dumped: str) -> None:
    assert "shipping_address" not in dumped
    assert "payment_method" not in dumped
    for needle in ADDRESS_NEEDLES:
        assert needle not in dumped


def test_assistant_link_context_remember_find_accept_receipts_stats(workspace):
    owner = WorkspaceClient(workspace.url, workspace.owner_key)
    personal = WorkspaceClient(workspace.url, workspace.personal_key)
    owner.demo_reset()

    reg = register_agent(workspace.url, "Muse · Sample", "assistant")
    assert str(reg.category) == "assistant" and str(reg.role) == "assistant"
    muse = AssistantClient(workspace.url, reg.key)
    me = muse.get_me()
    assert (me.agent_id, me.category, me.role) == (reg.agent_id, "assistant", "assistant")
    assert reg.key not in repr(muse)

    # Nothing before consent.
    with pytest.raises(WorkspaceError) as denied:
        muse.context()
    assert (denied.value.status, denied.value.code) == (403, "SCOPE_DENIED")
    assert str(denied.value) == "Workspace policy denied this request."
    assert reg.key not in str(denied.value) and reg.key not in repr(denied.value)

    # The consent link: pending until the owner approves it.
    link = muse.request_link()
    assert str(link.status) == "pending"
    assert link.url == f"{workspace.url}/owner/links/{link.id}"
    assert muse.request_link().id == link.id
    listed = [row for row in owner.list_links().links if row.id == link.id]
    assert len(listed) == 1 and listed[0].agent_id == reg.agent_id and str(listed[0].status) == "pending"
    with pytest.raises(WorkspaceError) as not_owner:
        personal.approve_link(link.id)
    assert not_owner.value.code == "SCOPE_DENIED"
    approved = owner.approve_link(link.id)
    assert str(approved.status) == "approved" and approved.session_id
    with pytest.raises(WorkspaceError) as twice:
        owner.approve_link(link.id)
    assert (twice.value.status, twice.value.code) == (409, "LINK_NOT_PENDING")
    view = muse.wait_for_link(link.id, interval_s=0.1, timeout_s=5)
    assert str(view.status) == "approved" and view.session_id == approved.session_id

    # First message: the Sample values the policy lets an assistant know; never the address or the payment method.
    ctx = muse.context()
    fields = ctx.fields.to_dict()
    assert {"lang": "zh", "shoe_size": "42"}.items() <= fields.items()
    assert {"lang", "tone", "shoe_size"} <= fields.keys()
    policy = owner.get_policy()
    auto = [str(f) for f in policy.policy.auto.assistant]
    assert sorted([*fields.keys(), *[str(f) for f in ctx.unknown]]) == sorted(auto)
    assert ctx.session_id == approved.session_id and ctx.policy_id == policy.policy_id
    no_secrets(json.dumps(ctx.to_dict(), ensure_ascii=False))

    # A stated preference, with the person's own words: stored "stated", and the next context carries it.
    evidence = {"conversationId": "sample-conv-py1", "snippet": "Sample: I only run in Brooks"}
    with pytest.raises(WorkspaceError) as missing:
        muse.remember("pref.brand", "Brooks", basis="stated")
    assert (missing.value.status, missing.value.code) == (422, "MISSING_FIELD")
    stored = muse.remember("pref.brand", "Brooks", basis="stated", evidence=evidence)
    assert str(stored.stored) == "stated"
    assert str(stored.contribution.field) == "pref.brand" and stored.contribution.value == "Brooks"
    assert muse.context().fields.to_dict().get("pref.brand") == "Brooks"

    # It buys through the workspace: its own intent, the recorded quotes, an accept the store answers.
    found = muse.find(PINNED_TEXT, "py-find-0001", public=PINNED_PUBLIC, kind="trail_shoes")
    assert is_sample(found)
    ucp = [q for q in found.quotes if q.seller]
    assert len(ucp) == 2
    assert sorted(q.seller for q in ucp) == sorted(o["seller"] for o in PINNED["offers"])
    assert all(q.currency == "USD" and q.intent_id == found.intent_id for q in ucp)
    accepted = muse.accept(ucp[0].id, "py-accept-0001")
    assert str(accepted.status) in ("ordered", "handoff", "blocked", "failed")
    dumped = json.dumps(accepted.to_dict(), ensure_ascii=False)
    for needle in ADDRESS_NEEDLES:
        assert needle not in dumped
    assert "payment_method" not in dumped

    # Receipts (owner key): the store read the address at checkout; the assistant's context read is an "assist".
    receipts = owner.get_receipts().receipts
    checkout = [r for r in receipts if r.purpose == "checkout" and r.intent_id == found.intent_id]
    assert len(checkout) == 1
    assert checkout[0].agent_id == ucp[0].agent_id and [str(f) for f in checkout[0].fields] == ["shipping_address"]
    assist = [r for r in receipts if r.purpose == "assist" and r.agent_id == reg.agent_id]
    assert len(assist) >= 1 and all(r.session_id == approved.session_id for r in assist)
    assert all("shipping_address" not in [str(f) for f in r.fields] for r in assist)

    stats = muse.stats()
    assert stats.intents >= 1 and stats.accepted >= 1
