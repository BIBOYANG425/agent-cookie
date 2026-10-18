from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.category import Category
from ..types import UNSET, Unset

T = TypeVar("T", bound="RegisterRequest")


@_attrs_define
class RegisterRequest:
    """POST /agents/register body. A personal agent needs the owner key; an assistant takes no callbackUrl or chatEndpoint.

    Attributes:
        name (str): At most 200 UTF-8 bytes.
        category (Category): pharmacy and hotel were cut on 2026-10-17; they come back after the hackathon, not before.
            "retail" (2026-10-17, human direction: search is driven by the user's own words): the category of UCP store
            proxies (`ucp:<domain>`), whatever they sell. Same policy as "shoe" (policy.ts). "shoe" stays for registered
            merchants that declared it.
        capabilities (list[str] | Unset): Up to 20 strings of 1–64 characters; a registered merchant listing an intent's
            `kind` here is introduced to it.
        callback_url (str | Unset): http(s) URL where the workspace POSTs `introduce` and `accepted` callbacks
            (MerchantCallback). Merchants only.
        chat_endpoint (str | Unset): Tier 0: http(s) URL of a chat endpoint that receives the handshake as a text
            prefix. Merchants only.
    """

    name: str
    category: Category
    capabilities: list[str] | Unset = UNSET
    callback_url: str | Unset = UNSET
    chat_endpoint: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        category = self.category.value

        capabilities: list[str] | Unset = UNSET
        if not isinstance(self.capabilities, Unset):
            capabilities = self.capabilities

        callback_url = self.callback_url

        chat_endpoint = self.chat_endpoint

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "category": category,
            }
        )
        if capabilities is not UNSET:
            field_dict["capabilities"] = capabilities
        if callback_url is not UNSET:
            field_dict["callbackUrl"] = callback_url
        if chat_endpoint is not UNSET:
            field_dict["chatEndpoint"] = chat_endpoint

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        name = d.pop("name")

        category = Category(d.pop("category"))

        capabilities = cast(list[str], d.pop("capabilities", UNSET))

        callback_url = d.pop("callbackUrl", UNSET)

        chat_endpoint = d.pop("chatEndpoint", UNSET)

        register_request = cls(
            name=name,
            category=category,
            capabilities=capabilities,
            callback_url=callback_url,
            chat_endpoint=chat_endpoint,
        )

        register_request.additional_properties = d
        return register_request

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
