from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.mint_key_result_role import MintKeyResultRole

T = TypeVar("T", bound="MintKeyResult")


@_attrs_define
class MintKeyResult:
    """POST /owner/keys → 201. The key is shown here once and never again (only its hash is stored); keep it in
    AGENT_COOKIE_KEY.

        Attributes:
            key (str):
            agent_id (str):
            role (MintKeyResultRole):
            label (str):
            created_at (str):
    """

    key: str
    agent_id: str
    role: MintKeyResultRole
    label: str
    created_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        agent_id = self.agent_id

        role = self.role.value

        label = self.label

        created_at = self.created_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "key": key,
                "agentId": agent_id,
                "role": role,
                "label": label,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        key = d.pop("key")

        agent_id = d.pop("agentId")

        role = MintKeyResultRole(d.pop("role"))

        label = d.pop("label")

        created_at = d.pop("createdAt")

        mint_key_result = cls(
            key=key,
            agent_id=agent_id,
            role=role,
            label=label,
            created_at=created_at,
        )

        mint_key_result.additional_properties = d
        return mint_key_result

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
