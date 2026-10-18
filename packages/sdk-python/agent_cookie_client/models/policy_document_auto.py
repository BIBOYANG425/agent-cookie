from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.field import Field

T = TypeVar("T", bound="PolicyDocumentAuto")


@_attrs_define
class PolicyDocumentAuto:
    """Readable with the handshake, no purpose needed.

    Attributes:
        personal (list[Field]):
        shoe (list[Field]):
        retail (list[Field]):
        assistant (list[Field]):
    """

    personal: list[Field]
    shoe: list[Field]
    retail: list[Field]
    assistant: list[Field]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        personal = []
        for personal_item_data in self.personal:
            personal_item = personal_item_data.value
            personal.append(personal_item)

        shoe = []
        for shoe_item_data in self.shoe:
            shoe_item = shoe_item_data.value
            shoe.append(shoe_item)

        retail = []
        for retail_item_data in self.retail:
            retail_item = retail_item_data.value
            retail.append(retail_item)

        assistant = []
        for assistant_item_data in self.assistant:
            assistant_item = assistant_item_data.value
            assistant.append(assistant_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "personal": personal,
                "shoe": shoe,
                "retail": retail,
                "assistant": assistant,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        personal = []
        _personal = d.pop("personal")
        for personal_item_data in _personal:
            personal_item = Field(personal_item_data)

            personal.append(personal_item)

        shoe = []
        _shoe = d.pop("shoe")
        for shoe_item_data in _shoe:
            shoe_item = Field(shoe_item_data)

            shoe.append(shoe_item)

        retail = []
        _retail = d.pop("retail")
        for retail_item_data in _retail:
            retail_item = Field(retail_item_data)

            retail.append(retail_item)

        assistant = []
        _assistant = d.pop("assistant")
        for assistant_item_data in _assistant:
            assistant_item = Field(assistant_item_data)

            assistant.append(assistant_item)

        policy_document_auto = cls(
            personal=personal,
            shoe=shoe,
            retail=retail,
            assistant=assistant,
        )

        policy_document_auto.additional_properties = d
        return policy_document_auto

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
