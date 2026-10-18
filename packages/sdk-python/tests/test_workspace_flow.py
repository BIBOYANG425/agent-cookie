"""The person's own agent and the owner's keys through the Python SDK against the real demo workspace."""

from __future__ import annotations

import json

import pytest

from agent_cookie import WorkspaceClient, WorkspaceError, is_sample


def test_owner_mints_a_personal_key_which_reads_the_card_and_is_revoked(workspace):
    owner = WorkspaceClient(workspace.url, workspace.owner_key)
    owner.demo_reset()

    minted = owner.mint_key("py-laptop", "personal", "Sample laptop")
    assert (minted.agent_id, str(minted.role), minted.label) == ("py-laptop", "personal", "Sample laptop")
    listed = [k for k in owner.list_keys().keys if k.agent_id == "py-laptop"]
    assert len(listed) == 1 and str(listed[0].role) == "personal"
    assert minted.key not in json.dumps(owner.list_keys().to_dict())

    me = WorkspaceClient(workspace.url, minted.key)
    assert str(me.get_me().role) == "personal"
    card = me.get_my_card()
    assert is_sample(card)
    on_card = {str(f.field): f.value for f in card.card}
    assert on_card.get("shoe_size") == "42" and on_card.get("lang") == "zh"

    stated = me.remember("pref.color", "teal")
    assert str(stated.field) == "pref.color" and str(stated.basis) == "stated"

    found = me.find("Sample · a trail running shoe, EU 42", "py-find-me-0001", public={"budget": "120", "shoe_size": "42"})
    assert found.intent_id and is_sample(found)
    if found.quotes:
        result = me.accept(found.quotes[0].id, f"accept-{found.quotes[0].id}")
        assert str(result.status) in ("ordered", "handoff", "blocked", "failed")

    revoked = owner.revoke_key("py-laptop")
    assert revoked.ok
    with pytest.raises(WorkspaceError) as gone:
        me.get_me()
    assert (gone.value.status, gone.value.code) == (401, "AUTH_REQUIRED")
    assert minted.key not in str(gone.value)
