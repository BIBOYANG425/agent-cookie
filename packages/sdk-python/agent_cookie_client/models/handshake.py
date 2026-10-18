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

from ..models.field import Field
from ..types import UNSET, Unset

T = TypeVar("T", bound="Handshake")


@_attrs_define
class Handshake:
    """A04 wording: lang / tone / length ARE three values — they say "how to talk to me" and travel with every handshake.
    "No values in the handshake" means `available` lists field NAMES only; every other value is fetched through GET
    /agent/fields and checked against policy, grant and purpose at read time.

        Attributes:
            v (Literal[1]):
            session_id (str):
            jar (str): Workspace API base URL. The merchant calls this; no discovery mechanism needed.
            lang (str):
            tone (str):
            length (str):
            available (list[Field]): Field names only, never values.
            expires_at (str):
            sig (str | Unset): Added by lane D (TD2).
            kid (str | Unset):
    """

    v: Literal[1]
    session_id: str
    jar: str
    lang: str
    tone: str
    length: str
    available: list[Field]
    expires_at: str
    sig: str | Unset = UNSET
    kid: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        v = self.v

        session_id = self.session_id

        jar = self.jar

        lang = self.lang

        tone = self.tone

        length = self.length

        available = []
        for available_item_data in self.available:
            available_item = available_item_data.value
            available.append(available_item)

        expires_at = self.expires_at

        sig = self.sig

        kid = self.kid

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "v": v,
                "sessionId": session_id,
                "jar": jar,
                "lang": lang,
                "tone": tone,
                "length": length,
                "available": available,
                "expiresAt": expires_at,
            }
        )
        if sig is not UNSET:
            field_dict["sig"] = sig
        if kid is not UNSET:
            field_dict["kid"] = kid

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        v = cast(Literal[1], d.pop("v"))
        if v != 1:
            raise ValueError(f"v must match const 1, got '{v}'")

        session_id = d.pop("sessionId")

        jar = d.pop("jar")

        lang = d.pop("lang")

        tone = d.pop("tone")

        length = d.pop("length")

        available = []
        _available = d.pop("available")
        for available_item_data in _available:
            available_item = Field(available_item_data)

            available.append(available_item)

        expires_at = d.pop("expiresAt")

        sig = d.pop("sig", UNSET)

        kid = d.pop("kid", UNSET)

        handshake = cls(
            v=v,
            session_id=session_id,
            jar=jar,
            lang=lang,
            tone=tone,
            length=length,
            available=available,
            expires_at=expires_at,
            sig=sig,
            kid=kid,
        )

        handshake.additional_properties = d
        return handshake

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
