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

T = TypeVar("T", bound="PublicJwk")


@_attrs_define
class PublicJwk:
    """A session's pairwise jar public key (lane D): Ed25519, as RFC 8037 OKP.

    Attributes:
        kty (Literal['OKP']):
        crv (Literal['Ed25519']):
        x (str):
        kid (str):
        alg (Literal['EdDSA']):
        use (Literal['sig']):
    """

    kty: Literal["OKP"]
    crv: Literal["Ed25519"]
    x: str
    kid: str
    alg: Literal["EdDSA"]
    use: Literal["sig"]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kty = self.kty

        crv = self.crv

        x = self.x

        kid = self.kid

        alg = self.alg

        use = self.use

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kty": kty,
                "crv": crv,
                "x": x,
                "kid": kid,
                "alg": alg,
                "use": use,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        kty = cast(Literal["OKP"], d.pop("kty"))
        if kty != "OKP":
            raise ValueError(f"kty must match const 'OKP', got '{kty}'")

        crv = cast(Literal["Ed25519"], d.pop("crv"))
        if crv != "Ed25519":
            raise ValueError(f"crv must match const 'Ed25519', got '{crv}'")

        x = d.pop("x")

        kid = d.pop("kid")

        alg = cast(Literal["EdDSA"], d.pop("alg"))
        if alg != "EdDSA":
            raise ValueError(f"alg must match const 'EdDSA', got '{alg}'")

        use = cast(Literal["sig"], d.pop("use"))
        if use != "sig":
            raise ValueError(f"use must match const 'sig', got '{use}'")

        public_jwk = cls(
            kty=kty,
            crv=crv,
            x=x,
            kid=kid,
            alg=alg,
            use=use,
        )

        public_jwk.additional_properties = d
        return public_jwk

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
