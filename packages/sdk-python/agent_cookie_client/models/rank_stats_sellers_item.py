from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="RankStatsSellersItem")


@_attrs_define
class RankStatsSellersItem:
    """
    Attributes:
        seller_domain (str):
        size_rank (float):
        pref_rank (float):
        outcome_rank (float):
        picked (bool):
    """

    seller_domain: str
    size_rank: float
    pref_rank: float
    outcome_rank: float
    picked: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        seller_domain = self.seller_domain

        size_rank = self.size_rank

        pref_rank = self.pref_rank

        outcome_rank = self.outcome_rank

        picked = self.picked

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sellerDomain": seller_domain,
                "sizeRank": size_rank,
                "prefRank": pref_rank,
                "outcomeRank": outcome_rank,
                "picked": picked,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        seller_domain = d.pop("sellerDomain")

        size_rank = d.pop("sizeRank")

        pref_rank = d.pop("prefRank")

        outcome_rank = d.pop("outcomeRank")

        picked = d.pop("picked")

        rank_stats_sellers_item = cls(
            seller_domain=seller_domain,
            size_rank=size_rank,
            pref_rank=pref_rank,
            outcome_rank=outcome_rank,
            picked=picked,
        )

        rank_stats_sellers_item.additional_properties = d
        return rank_stats_sellers_item

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
