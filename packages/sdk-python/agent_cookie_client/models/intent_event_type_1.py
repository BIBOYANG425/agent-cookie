from __future__ import annotations

from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="IntentEventType1")


@_attrs_define
class IntentEventType1:
    """
    Attributes:
        type_ (Literal['complete']):
        intent_id (str):
    """

    type_: Literal["complete"]
    intent_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        intent_id = self.intent_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "intentId": intent_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        type_ = cast(Literal["complete"], d.pop("type"))
        if type_ != "complete":
            raise ValueError(f"type must match const 'complete', got '{type_}'")

        intent_id = d.pop("intentId")

        intent_event_type_1 = cls(
            type_=type_,
            intent_id=intent_id,
        )

        intent_event_type_1.additional_properties = d
        return intent_event_type_1

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
