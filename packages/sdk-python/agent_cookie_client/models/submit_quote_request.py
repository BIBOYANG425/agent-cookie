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

from ..types import UNSET, Unset

T = TypeVar("T", bound="SubmitQuoteRequest")


@_attrs_define
class SubmitQuoteRequest:
    """POST /agent/quotes body.

    Attributes:
        intent_id (str):
        text (str): What the user reads: at most 1000 UTF-8 bytes.
        price (int): Integer cents of USD (11995 = $119.95).
        currency (Literal['USD'] | Unset):
        eta_date (None | str | Unset): YYYY-MM-DD (or a full ISO timestamp) only when the merchant commits to a date;
            null or absent when unknown.
        eta_text (str | Unset): The merchant's own delivery wording, at most 200 bytes.
        title (str | Unset):
        checkout_url (str | Unset): https only, no credentials in the URL.
    """

    intent_id: str
    text: str
    price: int
    currency: Literal["USD"] | Unset = UNSET
    eta_date: None | str | Unset = UNSET
    eta_text: str | Unset = UNSET
    title: str | Unset = UNSET
    checkout_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        intent_id = self.intent_id

        text = self.text

        price = self.price

        currency = self.currency

        eta_date: None | str | Unset
        if isinstance(self.eta_date, Unset):
            eta_date = UNSET
        else:
            eta_date = self.eta_date

        eta_text = self.eta_text

        title = self.title

        checkout_url = self.checkout_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "intentId": intent_id,
                "text": text,
                "price": price,
            }
        )
        if currency is not UNSET:
            field_dict["currency"] = currency
        if eta_date is not UNSET:
            field_dict["etaDate"] = eta_date
        if eta_text is not UNSET:
            field_dict["etaText"] = eta_text
        if title is not UNSET:
            field_dict["title"] = title
        if checkout_url is not UNSET:
            field_dict["checkoutUrl"] = checkout_url

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        intent_id = d.pop("intentId")

        text = d.pop("text")

        price = d.pop("price")

        currency = cast(Literal["USD"] | Unset, d.pop("currency", UNSET))
        if currency != "USD" and not isinstance(currency, Unset):
            raise ValueError(f"currency must match const 'USD', got '{currency}'")

        def _parse_eta_date(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        eta_date = _parse_eta_date(d.pop("etaDate", UNSET))

        eta_text = d.pop("etaText", UNSET)

        title = d.pop("title", UNSET)

        checkout_url = d.pop("checkoutUrl", UNSET)

        submit_quote_request = cls(
            intent_id=intent_id,
            text=text,
            price=price,
            currency=currency,
            eta_date=eta_date,
            eta_text=eta_text,
            title=title,
            checkout_url=checkout_url,
        )

        submit_quote_request.additional_properties = d
        return submit_quote_request

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
