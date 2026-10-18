from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="AssistantContextFields")


@_attrs_define
class AssistantContextFields:
    """
    Attributes:
        lang (str | Unset):
        tone (str | Unset):
        length (str | Unset):
        shoe_size (str | Unset):
        budget (str | Unset):
        deadline (str | Unset):
        shipping_address (str | Unset):
        payment_method (str | Unset):
        pref_brand (str | Unset):
        pref_color (str | Unset):
        pref_material (str | Unset):
        pref_style (str | Unset):
        pref_fit (str | Unset):
        pref_avoid (str | Unset):
        pref_occasion (str | Unset):
        pref_recipient (str | Unset):
        pref_price_band (str | Unset):
        pref_size_system (str | Unset):
    """

    lang: str | Unset = UNSET
    tone: str | Unset = UNSET
    length: str | Unset = UNSET
    shoe_size: str | Unset = UNSET
    budget: str | Unset = UNSET
    deadline: str | Unset = UNSET
    shipping_address: str | Unset = UNSET
    payment_method: str | Unset = UNSET
    pref_brand: str | Unset = UNSET
    pref_color: str | Unset = UNSET
    pref_material: str | Unset = UNSET
    pref_style: str | Unset = UNSET
    pref_fit: str | Unset = UNSET
    pref_avoid: str | Unset = UNSET
    pref_occasion: str | Unset = UNSET
    pref_recipient: str | Unset = UNSET
    pref_price_band: str | Unset = UNSET
    pref_size_system: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        lang = self.lang

        tone = self.tone

        length = self.length

        shoe_size = self.shoe_size

        budget = self.budget

        deadline = self.deadline

        shipping_address = self.shipping_address

        payment_method = self.payment_method

        pref_brand = self.pref_brand

        pref_color = self.pref_color

        pref_material = self.pref_material

        pref_style = self.pref_style

        pref_fit = self.pref_fit

        pref_avoid = self.pref_avoid

        pref_occasion = self.pref_occasion

        pref_recipient = self.pref_recipient

        pref_price_band = self.pref_price_band

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
        lang = d.pop("lang", UNSET)

        tone = d.pop("tone", UNSET)

        length = d.pop("length", UNSET)

        shoe_size = d.pop("shoe_size", UNSET)

        budget = d.pop("budget", UNSET)

        deadline = d.pop("deadline", UNSET)

        shipping_address = d.pop("shipping_address", UNSET)

        payment_method = d.pop("payment_method", UNSET)

        pref_brand = d.pop("pref.brand", UNSET)

        pref_color = d.pop("pref.color", UNSET)

        pref_material = d.pop("pref.material", UNSET)

        pref_style = d.pop("pref.style", UNSET)

        pref_fit = d.pop("pref.fit", UNSET)

        pref_avoid = d.pop("pref.avoid", UNSET)

        pref_occasion = d.pop("pref.occasion", UNSET)

        pref_recipient = d.pop("pref.recipient", UNSET)

        pref_price_band = d.pop("pref.price_band", UNSET)

        pref_size_system = d.pop("pref.size_system", UNSET)

        assistant_context_fields = cls(
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

        assistant_context_fields.additional_properties = d
        return assistant_context_fields

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
