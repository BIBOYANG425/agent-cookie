from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.field import Field
from ..types import UNSET, Unset

T = TypeVar("T", bound="Receipt")


@_attrs_define
class Receipt:
    """
    Attributes:
        id (str):
        session_id (str):
        agent_id (str):
        fields (list[Field]):
        purpose (str):
        created_at (str):
        amount (float | Unset): Filled by lane D's payment authorization.
        intent_id (str | Unset): Additive (Phase 0): the intent whose grant authorized the release; absent on legacy
            rows. Funnel attribution only.
        policy_id (str | Unset): Additive (Phase 1): id of the policy document that allowed this release (policy-
            document.ts policyId).
    """

    id: str
    session_id: str
    agent_id: str
    fields: list[Field]
    purpose: str
    created_at: str
    amount: float | Unset = UNSET
    intent_id: str | Unset = UNSET
    policy_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        agent_id = self.agent_id

        fields = []
        for fields_item_data in self.fields:
            fields_item = fields_item_data.value
            fields.append(fields_item)

        purpose = self.purpose

        created_at = self.created_at

        amount = self.amount

        intent_id = self.intent_id

        policy_id = self.policy_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionId": session_id,
                "agentId": agent_id,
                "fields": fields,
                "purpose": purpose,
                "createdAt": created_at,
            }
        )
        if amount is not UNSET:
            field_dict["amount"] = amount
        if intent_id is not UNSET:
            field_dict["intentId"] = intent_id
        if policy_id is not UNSET:
            field_dict["policyId"] = policy_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionId")

        agent_id = d.pop("agentId")

        fields = []
        _fields = d.pop("fields")
        for fields_item_data in _fields:
            fields_item = Field(fields_item_data)

            fields.append(fields_item)

        purpose = d.pop("purpose")

        created_at = d.pop("createdAt")

        amount = d.pop("amount", UNSET)

        intent_id = d.pop("intentId", UNSET)

        policy_id = d.pop("policyId", UNSET)

        receipt = cls(
            id=id,
            session_id=session_id,
            agent_id=agent_id,
            fields=fields,
            purpose=purpose,
            created_at=created_at,
            amount=amount,
            intent_id=intent_id,
            policy_id=policy_id,
        )

        receipt.additional_properties = d
        return receipt

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
