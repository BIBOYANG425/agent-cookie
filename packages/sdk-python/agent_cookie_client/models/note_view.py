from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="NoteView")


@_attrs_define
class NoteView:
    """GET /agent/notes/:key: the merchant's own note (anyone else gets 404). Reading it extends its expiry.

    Attributes:
        key (str):
        updated_at (str):
        expires_at (str):
        value (str):
    """

    key: str
    updated_at: str
    expires_at: str
    value: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        updated_at = self.updated_at

        expires_at = self.expires_at

        value = self.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "key": key,
                "updatedAt": updated_at,
                "expiresAt": expires_at,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        key = d.pop("key")

        updated_at = d.pop("updatedAt")

        expires_at = d.pop("expiresAt")

        value = d.pop("value")

        note_view = cls(
            key=key,
            updated_at=updated_at,
            expires_at=expires_at,
            value=value,
        )

        note_view.additional_properties = d
        return note_view

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
