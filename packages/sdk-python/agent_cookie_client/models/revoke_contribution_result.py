from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.card import Card


T = TypeVar("T", bound="RevokeContributionResult")


@_attrs_define
class RevokeContributionResult:
    """POST /personal/contributions/:id/revoke: the recomputed card.

    Attributes:
        ok (bool):
        card (Card): Return shape of RulesApi.mergeCard and of GET /personal/card.
    """

    ok: bool
    card: Card
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ok = self.ok

        card = self.card.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "ok": ok,
                "card": card,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.card import Card

        d = dict(src_dict)
        ok = d.pop("ok")

        card = Card.from_dict(d.pop("card"))

        revoke_contribution_result = cls(
            ok=ok,
            card=card,
        )

        revoke_contribution_result.additional_properties = d
        return revoke_contribution_result

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
