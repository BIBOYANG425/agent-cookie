from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.fields_response_fields import FieldsResponseFields


T = TypeVar("T", bound="FieldsResponse")


@_attrs_define
class FieldsResponse:
    """GET /agent/fields → 200: the released values. A requested field the user has no value for is absent.

    Attributes:
        session_id (str):
        purpose (str): The purpose the read was made under ("" for auto fields).
        fields (FieldsResponseFields):
    """

    session_id: str
    purpose: str
    fields: FieldsResponseFields
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        purpose = self.purpose

        fields = self.fields.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessionId": session_id,
                "purpose": purpose,
                "fields": fields,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.fields_response_fields import FieldsResponseFields

        d = dict(src_dict)
        session_id = d.pop("sessionId")

        purpose = d.pop("purpose")

        fields = FieldsResponseFields.from_dict(d.pop("fields"))

        fields_response = cls(
            session_id=session_id,
            purpose=purpose,
            fields=fields,
        )

        fields_response.additional_properties = d
        return fields_response

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
