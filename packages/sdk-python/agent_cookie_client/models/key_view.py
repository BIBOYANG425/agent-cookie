from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.key_view_role import KeyViewRole
from ..types import UNSET, Unset

T = TypeVar("T", bound="KeyView")


@_attrs_define
class KeyView:
    """One key the owner minted, as GET /owner/keys lists it: never the key or its hash. The owner key itself and keys made
    by POST /agents/register or the Sample seed are not listed (they carry no label).

        Attributes:
            agent_id (str):
            role (KeyViewRole):
            label (str):
            created_at (str):
            revoked_at (str | Unset): Set once POST /owner/keys/:agentId/revoke revoked it; a revoked key answers 401
                AUTH_REQUIRED.
    """

    agent_id: str
    role: KeyViewRole
    label: str
    created_at: str
    revoked_at: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        agent_id = self.agent_id

        role = self.role.value

        label = self.label

        created_at = self.created_at

        revoked_at = self.revoked_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "agentId": agent_id,
                "role": role,
                "label": label,
                "createdAt": created_at,
            }
        )
        if revoked_at is not UNSET:
            field_dict["revokedAt"] = revoked_at

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        role = KeyViewRole(d.pop("role"))

        label = d.pop("label")

        created_at = d.pop("createdAt")

        revoked_at = d.pop("revokedAt", UNSET)

        key_view = cls(
            agent_id=agent_id,
            role=role,
            label=label,
            created_at=created_at,
            revoked_at=revoked_at,
        )

        key_view.additional_properties = d
        return key_view

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
