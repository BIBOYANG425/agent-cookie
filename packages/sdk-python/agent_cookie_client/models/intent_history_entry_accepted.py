from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="IntentHistoryEntryAccepted")


@_attrs_define
class IntentHistoryEntryAccepted:
    """The quote the user accepted for this intent, if any.

    Attributes:
        quote_id (str):
        price (float):
        status (str):
        title (str | Unset):
        seller (str | Unset):
    """

    quote_id: str
    price: float
    status: str
    title: str | Unset = UNSET
    seller: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        quote_id = self.quote_id

        price = self.price

        status = self.status

        title = self.title

        seller = self.seller

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "quoteId": quote_id,
                "price": price,
                "status": status,
            }
        )
        if title is not UNSET:
            field_dict["title"] = title
        if seller is not UNSET:
            field_dict["seller"] = seller

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        quote_id = d.pop("quoteId")

        price = d.pop("price")

        status = d.pop("status")

        title = d.pop("title", UNSET)

        seller = d.pop("seller", UNSET)

        intent_history_entry_accepted = cls(
            quote_id=quote_id,
            price=price,
            status=status,
            title=title,
            seller=seller,
        )

        intent_history_entry_accepted.additional_properties = d
        return intent_history_entry_accepted

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
