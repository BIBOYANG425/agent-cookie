from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PolicyDocumentPurposeRetail")


@_attrs_define
class PolicyDocumentPurposeRetail:
    """
    Attributes:
        lang (list[str] | Unset):
        tone (list[str] | Unset):
        length (list[str] | Unset):
        shoe_size (list[str] | Unset):
        budget (list[str] | Unset):
        deadline (list[str] | Unset):
        shipping_address (list[str] | Unset):
        payment_method (list[str] | Unset):
        pref_brand (list[str] | Unset):
        pref_color (list[str] | Unset):
        pref_material (list[str] | Unset):
        pref_style (list[str] | Unset):
        pref_fit (list[str] | Unset):
        pref_avoid (list[str] | Unset):
        pref_occasion (list[str] | Unset):
        pref_recipient (list[str] | Unset):
        pref_price_band (list[str] | Unset):
        pref_size_system (list[str] | Unset):
    """

    lang: list[str] | Unset = UNSET
    tone: list[str] | Unset = UNSET
    length: list[str] | Unset = UNSET
    shoe_size: list[str] | Unset = UNSET
    budget: list[str] | Unset = UNSET
    deadline: list[str] | Unset = UNSET
    shipping_address: list[str] | Unset = UNSET
    payment_method: list[str] | Unset = UNSET
    pref_brand: list[str] | Unset = UNSET
    pref_color: list[str] | Unset = UNSET
    pref_material: list[str] | Unset = UNSET
    pref_style: list[str] | Unset = UNSET
    pref_fit: list[str] | Unset = UNSET
    pref_avoid: list[str] | Unset = UNSET
    pref_occasion: list[str] | Unset = UNSET
    pref_recipient: list[str] | Unset = UNSET
    pref_price_band: list[str] | Unset = UNSET
    pref_size_system: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        lang: list[str] | Unset = UNSET
        if not isinstance(self.lang, Unset):
            lang = self.lang

        tone: list[str] | Unset = UNSET
        if not isinstance(self.tone, Unset):
            tone = self.tone

        length: list[str] | Unset = UNSET
        if not isinstance(self.length, Unset):
            length = self.length

        shoe_size: list[str] | Unset = UNSET
        if not isinstance(self.shoe_size, Unset):
            shoe_size = self.shoe_size

        budget: list[str] | Unset = UNSET
        if not isinstance(self.budget, Unset):
            budget = self.budget

        deadline: list[str] | Unset = UNSET
        if not isinstance(self.deadline, Unset):
            deadline = self.deadline

        shipping_address: list[str] | Unset = UNSET
        if not isinstance(self.shipping_address, Unset):
            shipping_address = self.shipping_address

        payment_method: list[str] | Unset = UNSET
        if not isinstance(self.payment_method, Unset):
            payment_method = self.payment_method

        pref_brand: list[str] | Unset = UNSET
        if not isinstance(self.pref_brand, Unset):
            pref_brand = self.pref_brand

        pref_color: list[str] | Unset = UNSET
        if not isinstance(self.pref_color, Unset):
            pref_color = self.pref_color

        pref_material: list[str] | Unset = UNSET
        if not isinstance(self.pref_material, Unset):
            pref_material = self.pref_material

        pref_style: list[str] | Unset = UNSET
        if not isinstance(self.pref_style, Unset):
            pref_style = self.pref_style

        pref_fit: list[str] | Unset = UNSET
        if not isinstance(self.pref_fit, Unset):
            pref_fit = self.pref_fit

        pref_avoid: list[str] | Unset = UNSET
        if not isinstance(self.pref_avoid, Unset):
            pref_avoid = self.pref_avoid

        pref_occasion: list[str] | Unset = UNSET
        if not isinstance(self.pref_occasion, Unset):
            pref_occasion = self.pref_occasion

        pref_recipient: list[str] | Unset = UNSET
        if not isinstance(self.pref_recipient, Unset):
            pref_recipient = self.pref_recipient

        pref_price_band: list[str] | Unset = UNSET
        if not isinstance(self.pref_price_band, Unset):
            pref_price_band = self.pref_price_band

        pref_size_system: list[str] | Unset = UNSET
        if not isinstance(self.pref_size_system, Unset):
            pref_size_system = self.pref_size_system

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if lang is not UNSET:
            field_dict["lang"] = lang
        if tone is not UNSET:
            field_dict["tone"] = tone
        if length is not UNSET:
            field_dict["length"] = length
        if shoe_size is not UNSET:
            field_dict["shoe_size"] = shoe_size
        if budget is not UNSET:
            field_dict["budget"] = budget
        if deadline is not UNSET:
            field_dict["deadline"] = deadline
        if shipping_address is not UNSET:
            field_dict["shipping_address"] = shipping_address
        if payment_method is not UNSET:
            field_dict["payment_method"] = payment_method
        if pref_brand is not UNSET:
            field_dict["pref.brand"] = pref_brand
        if pref_color is not UNSET:
            field_dict["pref.color"] = pref_color
        if pref_material is not UNSET:
            field_dict["pref.material"] = pref_material
        if pref_style is not UNSET:
            field_dict["pref.style"] = pref_style
        if pref_fit is not UNSET:
            field_dict["pref.fit"] = pref_fit
        if pref_avoid is not UNSET:
            field_dict["pref.avoid"] = pref_avoid
        if pref_occasion is not UNSET:
            field_dict["pref.occasion"] = pref_occasion
        if pref_recipient is not UNSET:
            field_dict["pref.recipient"] = pref_recipient
        if pref_price_band is not UNSET:
            field_dict["pref.price_band"] = pref_price_band
        if pref_size_system is not UNSET:
            field_dict["pref.size_system"] = pref_size_system

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        lang = cast(list[str], d.pop("lang", UNSET))

        tone = cast(list[str], d.pop("tone", UNSET))

        length = cast(list[str], d.pop("length", UNSET))

        shoe_size = cast(list[str], d.pop("shoe_size", UNSET))

        budget = cast(list[str], d.pop("budget", UNSET))

        deadline = cast(list[str], d.pop("deadline", UNSET))

        shipping_address = cast(list[str], d.pop("shipping_address", UNSET))

        payment_method = cast(list[str], d.pop("payment_method", UNSET))

        pref_brand = cast(list[str], d.pop("pref.brand", UNSET))

        pref_color = cast(list[str], d.pop("pref.color", UNSET))

        pref_material = cast(list[str], d.pop("pref.material", UNSET))

        pref_style = cast(list[str], d.pop("pref.style", UNSET))

        pref_fit = cast(list[str], d.pop("pref.fit", UNSET))

        pref_avoid = cast(list[str], d.pop("pref.avoid", UNSET))

        pref_occasion = cast(list[str], d.pop("pref.occasion", UNSET))

        pref_recipient = cast(list[str], d.pop("pref.recipient", UNSET))

        pref_price_band = cast(list[str], d.pop("pref.price_band", UNSET))

        pref_size_system = cast(list[str], d.pop("pref.size_system", UNSET))

        policy_document_purpose_retail = cls(
            lang=lang,
            tone=tone,
            length=length,
            shoe_size=shoe_size,
            budget=budget,
            deadline=deadline,
            shipping_address=shipping_address,
            payment_method=payment_method,
            pref_brand=pref_brand,
            pref_color=pref_color,
            pref_material=pref_material,
            pref_style=pref_style,
            pref_fit=pref_fit,
            pref_avoid=pref_avoid,
            pref_occasion=pref_occasion,
            pref_recipient=pref_recipient,
            pref_price_band=pref_price_band,
            pref_size_system=pref_size_system,
        )

        policy_document_purpose_retail.additional_properties = d
        return policy_document_purpose_retail

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
