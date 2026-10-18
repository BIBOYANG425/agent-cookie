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

from ..models.data_source import DataSource
from ..types import UNSET, Unset

T = TypeVar("T", bound="Quote")


@_attrs_define
class Quote:
    """
    Attributes:
        id (str):
        intent_id (str):
        agent_id (str):
        text (str):
        price (float): Integer, minor units of `currency` (cents): 11995 means $119.95. Same convention as UCP.
        currency (Literal['USD']):
        eta_date (None | str | Unset): ISO date when the merchant committed to one; null when unknown. Not knowing the
            arrival date is the normal case (UCP catalog results carry no delivery estimate) — never invent one. Put the
            merchant's own wording, if any, in `etaText`.
        eta_text (str | Unset):
        title (str | Unset):
        seller (str | Unset): seller.domain of the UCP store (the proxy agent's `domain`).
        variant_id (str | Unset):
        checkout_url (str | Unset):
        source (DataSource | Unset): Where a response's data comes from (lane B, B20). "sample" = Sample seed/demo data
            (fixtures); "fixture" = recorded upstream responses replayed (AGENT_COOKIE_UCP=fixture); "live" = real upstream
            calls or real agent input. Clients label "sample" and "fixture" data as Sample and never present them as live
            inventory or identity.
        size_note (str | Unset): UCP quotes, when the wanted size (stated in the request, else the card's) is not this
            variant's: what the store has instead, e.g. "没有 42，有 41、43" / "No 42; has 41, 43". Absent when sizes match or do
            not apply.
    """

    id: str
    intent_id: str
    agent_id: str
    text: str
    price: float
    currency: Literal["USD"]
    eta_date: None | str | Unset = UNSET
    eta_text: str | Unset = UNSET
    title: str | Unset = UNSET
    seller: str | Unset = UNSET
    variant_id: str | Unset = UNSET
    checkout_url: str | Unset = UNSET
    source: DataSource | Unset = UNSET
    size_note: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        intent_id = self.intent_id

        agent_id = self.agent_id

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

        seller = self.seller

        variant_id = self.variant_id

        checkout_url = self.checkout_url

        source: str | Unset = UNSET
        if not isinstance(self.source, Unset):
            source = self.source.value

        size_note = self.size_note

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "intentId": intent_id,
                "agentId": agent_id,
                "text": text,
                "price": price,
                "currency": currency,
            }
        )
        if eta_date is not UNSET:
            field_dict["etaDate"] = eta_date
        if eta_text is not UNSET:
            field_dict["etaText"] = eta_text
        if title is not UNSET:
            field_dict["title"] = title
        if seller is not UNSET:
            field_dict["seller"] = seller
        if variant_id is not UNSET:
            field_dict["variantId"] = variant_id
        if checkout_url is not UNSET:
            field_dict["checkoutUrl"] = checkout_url
        if source is not UNSET:
            field_dict["source"] = source
        if size_note is not UNSET:
            field_dict["sizeNote"] = size_note

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        intent_id = d.pop("intentId")

        agent_id = d.pop("agentId")

        text = d.pop("text")

        price = d.pop("price")

        currency = cast(Literal["USD"], d.pop("currency"))
        if currency != "USD":
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

        seller = d.pop("seller", UNSET)

        variant_id = d.pop("variantId", UNSET)

        checkout_url = d.pop("checkoutUrl", UNSET)

        _source = d.pop("source", UNSET)
        source: DataSource | Unset
        if isinstance(_source, Unset):
            source = UNSET
        else:
            source = DataSource(_source)

        size_note = d.pop("sizeNote", UNSET)

        quote = cls(
            id=id,
            intent_id=intent_id,
            agent_id=agent_id,
            text=text,
            price=price,
            currency=currency,
            eta_date=eta_date,
            eta_text=eta_text,
            title=title,
            seller=seller,
            variant_id=variant_id,
            checkout_url=checkout_url,
            source=source,
            size_note=size_note,
        )

        quote.additional_properties = d
        return quote

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
