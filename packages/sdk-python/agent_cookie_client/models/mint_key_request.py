from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.mint_key_request_role import MintKeyRequestRole

T = TypeVar("T", bound="MintKeyRequest")


@_attrs_define
class MintKeyRequest:
    """POST /owner/keys body (bring-your-own-agent plan §7, the person's own agent): mint a key for one of the person's own
    agents (`role: "personal"`, category personal: it reads the whole card) or for a store's agent the owner adds by
    hand (`role: "merchant"`, category retail). `agentId` is the owner's own name for the agent
    (`[a-z0-9][a-z0-9_.-]{0,63}`, e.g. "laptop"); an unknown one is created with `label` as its name, an existing one
    must already have that role (else 422 MISSING_FIELD). An agent may hold several keys; each has its own label and
    revocation.

        Attributes:
            agent_id (str):
            role (MintKeyRequestRole):
            label (str): What this key is for, in the owner's words (1–200 UTF-8 bytes): "laptop", "the kitchen speaker".
                Never the key.
    """

    agent_id: str
    role: MintKeyRequestRole
    label: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        agent_id = self.agent_id

        role = self.role.value

        label = self.label

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "agentId": agent_id,
                "role": role,
                "label": label,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        role = MintKeyRequestRole(d.pop("role"))

        label = d.pop("label")

        mint_key_request = cls(
            agent_id=agent_id,
            role=role,
            label=label,
        )

        mint_key_request.additional_properties = d
        return mint_key_request

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
