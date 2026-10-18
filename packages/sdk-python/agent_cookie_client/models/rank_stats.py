from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.rank_stats_sellers_item import RankStatsSellersItem
    from ..models.ranking_weights import RankingWeights


T = TypeVar("T", bound="RankStats")


@_attrs_define
class RankStats:
    """What moved the order of one search (`ucp.rank` activity event). Ranks are the integer sort buckets, not scores.

    Attributes:
        weights (RankingWeights): Integer weights 0–100 in the policy document (`ranking`). Both 0, or the section
            absent, means today's order: pinned, size, preferences, budget, catalog order. outcomeRank =
            −(round(winRate·winRate) − round(failRate·failure)), so sellers with equal history tie and catalog order still
            breaks the tie.
        sellers (list[RankStatsSellersItem]):
    """

    weights: RankingWeights
    sellers: list[RankStatsSellersItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        weights = self.weights.to_dict()

        sellers = []
        for sellers_item_data in self.sellers:
            sellers_item = sellers_item_data.to_dict()
            sellers.append(sellers_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "weights": weights,
                "sellers": sellers,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.rank_stats_sellers_item import RankStatsSellersItem
        from ..models.ranking_weights import RankingWeights

        d = dict(src_dict)
        weights = RankingWeights.from_dict(d.pop("weights"))

        sellers = []
        _sellers = d.pop("sellers")
        for sellers_item_data in _sellers:
            sellers_item = RankStatsSellersItem.from_dict(sellers_item_data)

            sellers.append(sellers_item)

        rank_stats = cls(
            weights=weights,
            sellers=sellers,
        )

        rank_stats.additional_properties = d
        return rank_stats

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
