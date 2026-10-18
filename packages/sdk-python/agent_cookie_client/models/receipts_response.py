from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.receipt import Receipt


T = TypeVar("T", bound="ReceiptsResponse")


@_attrs_define
class ReceiptsResponse:
    """GET /personal/receipts. Newest first.

    Attributes:
        receipts (list[Receipt]):
    """

    receipts: list[Receipt]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        receipts = []
        for receipts_item_data in self.receipts:
            receipts_item = receipts_item_data.to_dict()
            receipts.append(receipts_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "receipts": receipts,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.receipt import Receipt

        d = dict(src_dict)
        receipts = []
        _receipts = d.pop("receipts")
        for receipts_item_data in _receipts:
            receipts_item = Receipt.from_dict(receipts_item_data)

            receipts.append(receipts_item)

        receipts_response = cls(
            receipts=receipts,
        )

        receipts_response.additional_properties = d
        return receipts_response

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
