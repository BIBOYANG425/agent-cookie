from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.field import Field
from ..models.funnel_stage import FunnelStage
from ..models.grant_view_status import GrantViewStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="GrantView")


@_attrs_define
class GrantView:
    """One row of GET /personal/grants: the contract Grant plus who holds it and how long it has left. No values.

    Attributes:
        id (str):
        session_id (str):
        fields (list[Field]): Fields readable with this grant without a purpose (the category's auto fields).
        purpose (str):
        expires_at (str):
        agent_id (str):
        agent_name (str):
        created_at (str):
        remaining_ms (int): Milliseconds until expiry; 0 unless live.
        status (GrantViewStatus):
        revoked_at (str | Unset):
        policy_id (str | Unset): Additive (Phase 1): id of the policy document the grant was issued under (policy-
            document.ts policyId).
        stage (FunnelStage | Unset): Where an intent is in the buying funnel. Ordered; a session's stage for an intent
            only moves forward.
    """

    id: str
    session_id: str
    fields: list[Field]
    purpose: str
    expires_at: str
    agent_id: str
    agent_name: str
    created_at: str
    remaining_ms: int
    status: GrantViewStatus
    revoked_at: str | Unset = UNSET
    policy_id: str | Unset = UNSET
    stage: FunnelStage | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        fields = []
        for fields_item_data in self.fields:
            fields_item = fields_item_data.value
            fields.append(fields_item)

        purpose = self.purpose

        expires_at = self.expires_at

        agent_id = self.agent_id

        agent_name = self.agent_name

        created_at = self.created_at

        remaining_ms = self.remaining_ms

        status = self.status.value

        revoked_at = self.revoked_at

        policy_id = self.policy_id

        stage: str | Unset = UNSET
        if not isinstance(self.stage, Unset):
            stage = self.stage.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionId": session_id,
                "fields": fields,
                "purpose": purpose,
                "expiresAt": expires_at,
                "agentId": agent_id,
                "agentName": agent_name,
                "createdAt": created_at,
                "remainingMs": remaining_ms,
                "status": status,
            }
        )
        if revoked_at is not UNSET:
            field_dict["revokedAt"] = revoked_at
        if policy_id is not UNSET:
            field_dict["policyId"] = policy_id
        if stage is not UNSET:
            field_dict["stage"] = stage

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionId")

        fields = []
        _fields = d.pop("fields")
        for fields_item_data in _fields:
            fields_item = Field(fields_item_data)

            fields.append(fields_item)

        purpose = d.pop("purpose")

        expires_at = d.pop("expiresAt")

        agent_id = d.pop("agentId")

        agent_name = d.pop("agentName")

        created_at = d.pop("createdAt")

        remaining_ms = d.pop("remainingMs")

        status = GrantViewStatus(d.pop("status"))

        revoked_at = d.pop("revokedAt", UNSET)

        policy_id = d.pop("policyId", UNSET)

        _stage = d.pop("stage", UNSET)
        stage: FunnelStage | Unset
        if isinstance(_stage, Unset):
            stage = UNSET
        else:
            stage = FunnelStage(_stage)

        grant_view = cls(
            id=id,
            session_id=session_id,
            fields=fields,
            purpose=purpose,
            expires_at=expires_at,
            agent_id=agent_id,
            agent_name=agent_name,
            created_at=created_at,
            remaining_ms=remaining_ms,
            status=status,
            revoked_at=revoked_at,
            policy_id=policy_id,
            stage=stage,
        )

        grant_view.additional_properties = d
        return grant_view

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
