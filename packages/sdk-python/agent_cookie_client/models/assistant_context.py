from __future__ import annotations

from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.field import Field

if TYPE_CHECKING:
    from ..models.assistant_context_fields import AssistantContextFields


T = TypeVar("T", bound="AssistantContext")


@_attrs_define
class AssistantContext:
    """GET /assistant/context: what a linked assistant may know, as VALUES (it acts for the user) but without provenance.
    `fields` = auto.assistant fields that have a value; `unknown` = auto.assistant fields without one (ask only when the
    task needs them); `writable` = write.assistant. A call that serves values writes a receipt (purpose "assist", field
    names only), except when the session's last assist receipt named the same fields under the same policy less than an
    hour ago (a chat reads its context on every message; every receipt is a git commit).

        Attributes:
            v (Literal[1]):
            session_id (str):
            policy_id (str):
            fields (AssistantContextFields):
            unknown (list[Field]):
            writable (list[Field]):
            expires_at (str):
    """

    v: Literal[1]
    session_id: str
    policy_id: str
    fields: AssistantContextFields
    unknown: list[Field]
    writable: list[Field]
    expires_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        v = self.v

        session_id = self.session_id

        policy_id = self.policy_id

        fields = self.fields.to_dict()

        unknown = []
        for unknown_item_data in self.unknown:
            unknown_item = unknown_item_data.value
            unknown.append(unknown_item)

        writable = []
        for writable_item_data in self.writable:
            writable_item = writable_item_data.value
            writable.append(writable_item)

        expires_at = self.expires_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "v": v,
                "sessionId": session_id,
                "policyId": policy_id,
                "fields": fields,
                "unknown": unknown,
                "writable": writable,
                "expiresAt": expires_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.assistant_context_fields import AssistantContextFields

        d = dict(src_dict)
        v = cast(Literal[1], d.pop("v"))
        if v != 1:
            raise ValueError(f"v must match const 1, got '{v}'")

        session_id = d.pop("sessionId")

        policy_id = d.pop("policyId")

        fields = AssistantContextFields.from_dict(d.pop("fields"))

        unknown = []
        _unknown = d.pop("unknown")
        for unknown_item_data in _unknown:
            unknown_item = Field(unknown_item_data)

            unknown.append(unknown_item)

        writable = []
        _writable = d.pop("writable")
        for writable_item_data in _writable:
            writable_item = Field(writable_item_data)

            writable.append(writable_item)

        expires_at = d.pop("expiresAt")

        assistant_context = cls(
            v=v,
            session_id=session_id,
            policy_id=policy_id,
            fields=fields,
            unknown=unknown,
            writable=writable,
            expires_at=expires_at,
        )

        assistant_context.additional_properties = d
        return assistant_context

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
