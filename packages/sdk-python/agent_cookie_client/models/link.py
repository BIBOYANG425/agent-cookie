from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.link_status import LinkStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="Link")


@_attrs_define
class Link:
    """Owner view (GET /owner/links).

    Attributes:
        id (str):
        agent_id (str):
        agent_name (str):
        status (LinkStatus):
        created_at (str):
        expires_at (str):
        decided_at (str | Unset): When approved or declined.
        session_id (str | Unset): Set on approval: the assistant's pairwise session.
    """

    id: str
    agent_id: str
    agent_name: str
    status: LinkStatus
    created_at: str
    expires_at: str
    decided_at: str | Unset = UNSET
    session_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        agent_id = self.agent_id

        agent_name = self.agent_name

        status = self.status.value

        created_at = self.created_at

        expires_at = self.expires_at

        decided_at = self.decided_at

        session_id = self.session_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "agentId": agent_id,
                "agentName": agent_name,
                "status": status,
                "createdAt": created_at,
                "expiresAt": expires_at,
            }
        )
        if decided_at is not UNSET:
            field_dict["decidedAt"] = decided_at
        if session_id is not UNSET:
            field_dict["sessionId"] = session_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        agent_id = d.pop("agentId")

        agent_name = d.pop("agentName")

        status = LinkStatus(d.pop("status"))

        created_at = d.pop("createdAt")

        expires_at = d.pop("expiresAt")

        decided_at = d.pop("decidedAt", UNSET)

        session_id = d.pop("sessionId", UNSET)

        link = cls(
            id=id,
            agent_id=agent_id,
            agent_name=agent_name,
            status=status,
            created_at=created_at,
            expires_at=expires_at,
            decided_at=decided_at,
            session_id=session_id,
        )

        link.additional_properties = d
        return link

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
