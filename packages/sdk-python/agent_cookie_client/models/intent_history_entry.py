from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.intent_history_entry_accepted import IntentHistoryEntryAccepted
    from ..models.intent_history_entry_public import IntentHistoryEntryPublic


T = TypeVar("T", bound="IntentHistoryEntry")


@_attrs_define
class IntentHistoryEntry:
    """GET /personal/intents?q= — the user's own intent history, newest first.

    Attributes:
        id (str):
        agent_id (str): The personal agent that asked.
        public (IntentHistoryEntryPublic):
        created_at (str):
        expires_at (str):
        text (str | Unset):
        query (str | Unset):
        kind (str | Unset):
        accepted (IntentHistoryEntryAccepted | Unset): The quote the user accepted for this intent, if any.
    """

    id: str
    agent_id: str
    public: IntentHistoryEntryPublic
    created_at: str
    expires_at: str
    text: str | Unset = UNSET
    query: str | Unset = UNSET
    kind: str | Unset = UNSET
    accepted: IntentHistoryEntryAccepted | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        agent_id = self.agent_id

        public = self.public.to_dict()

        created_at = self.created_at

        expires_at = self.expires_at

        text = self.text

        query = self.query

        kind = self.kind

        accepted: dict[str, Any] | Unset = UNSET
        if not isinstance(self.accepted, Unset):
            accepted = self.accepted.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "agentId": agent_id,
                "public": public,
                "createdAt": created_at,
                "expiresAt": expires_at,
            }
        )
        if text is not UNSET:
            field_dict["text"] = text
        if query is not UNSET:
            field_dict["query"] = query
        if kind is not UNSET:
            field_dict["kind"] = kind
        if accepted is not UNSET:
            field_dict["accepted"] = accepted

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.intent_history_entry_accepted import IntentHistoryEntryAccepted
        from ..models.intent_history_entry_public import IntentHistoryEntryPublic

        d = dict(src_dict)
        id = d.pop("id")

        agent_id = d.pop("agentId")

        public = IntentHistoryEntryPublic.from_dict(d.pop("public"))

        created_at = d.pop("createdAt")

        expires_at = d.pop("expiresAt")

        text = d.pop("text", UNSET)

        query = d.pop("query", UNSET)

        kind = d.pop("kind", UNSET)

        _accepted = d.pop("accepted", UNSET)
        accepted: IntentHistoryEntryAccepted | Unset
        if isinstance(_accepted, Unset):
            accepted = UNSET
        else:
            accepted = IntentHistoryEntryAccepted.from_dict(_accepted)

        intent_history_entry = cls(
            id=id,
            agent_id=agent_id,
            public=public,
            created_at=created_at,
            expires_at=expires_at,
            text=text,
            query=query,
            kind=kind,
            accepted=accepted,
        )

        intent_history_entry.additional_properties = d
        return intent_history_entry

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
