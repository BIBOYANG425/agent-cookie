from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.field import Field

T = TypeVar("T", bound="PersonalContributionRequest")


@_attrs_define
class PersonalContributionRequest:
    """POST /personal/contributions body: one fact the user stated (stored with basis "stated").

    Attributes:
        field (Field):
        value (str): At most 512 UTF-8 bytes. payment_method takes a provider token reference only; never a card number.
    """

    field: Field
    value: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field.value

        value = self.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "field": field,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        field = Field(d.pop("field"))

        value = d.pop("value")

        personal_contribution_request = cls(
            field=field,
            value=value,
        )

        personal_contribution_request.additional_properties = d
        return personal_contribution_request

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
