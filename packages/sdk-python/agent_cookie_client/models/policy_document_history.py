from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PolicyDocumentHistory")


@_attrs_define
class PolicyDocumentHistory:
    """Phase 4, optional: may read the person's intent and purchase history (GET /assistant/history for an assistant).
    Floor: personal always true, shoe and retail never; assistant is the owner's choice. Absent = personal only.

        Attributes:
            personal (bool | Unset):
            shoe (bool | Unset):
            retail (bool | Unset):
            assistant (bool | Unset):
    """

    personal: bool | Unset = UNSET
    shoe: bool | Unset = UNSET
    retail: bool | Unset = UNSET
    assistant: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        personal = self.personal

        shoe = self.shoe

        retail = self.retail

        assistant = self.assistant

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if personal is not UNSET:
            field_dict["personal"] = personal
        if shoe is not UNSET:
            field_dict["shoe"] = shoe
        if retail is not UNSET:
            field_dict["retail"] = retail
        if assistant is not UNSET:
            field_dict["assistant"] = assistant

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        personal = d.pop("personal", UNSET)

        shoe = d.pop("shoe", UNSET)

        retail = d.pop("retail", UNSET)

        assistant = d.pop("assistant", UNSET)

        policy_document_history = cls(
            personal=personal,
            shoe=shoe,
            retail=retail,
            assistant=assistant,
        )

        policy_document_history.additional_properties = d
        return policy_document_history

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
