from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.quote import Quote


T = TypeVar("T", bound="QuotesResponse")


@_attrs_define
class QuotesResponse:
    """GET /personal/intents/:id/quotes. `complete`: every introduced merchant that can quote has quoted.

    Attributes:
        intent_id (str):
        quotes (list[Quote]):
        complete (bool):
    """

    intent_id: str
    quotes: list[Quote]
    complete: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        intent_id = self.intent_id

        quotes = []
        for quotes_item_data in self.quotes:
            quotes_item = quotes_item_data.to_dict()
            quotes.append(quotes_item)

        complete = self.complete

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "intentId": intent_id,
                "quotes": quotes,
                "complete": complete,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.quote import Quote

        d = dict(src_dict)
        intent_id = d.pop("intentId")

        quotes = []
        _quotes = d.pop("quotes")
        for quotes_item_data in _quotes:
            quotes_item = Quote.from_dict(quotes_item_data)

            quotes.append(quotes_item)

        complete = d.pop("complete")

        quotes_response = cls(
            intent_id=intent_id,
            quotes=quotes,
            complete=complete,
        )

        quotes_response.additional_properties = d
        return quotes_response

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
