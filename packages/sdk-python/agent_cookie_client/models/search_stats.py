from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="SearchStats")


@_attrs_define
class SearchStats:
    """What the hard filters did to one catalog search (apps/workspace ucp-filter: USD, ships to the user's country,
    available, the budget stated in this request, the card's learned `pref.avoid`). `offers` = eligible + every dropped
    bucket; an offer is counted in the first bucket that rejects it, checked in the order avoid, currency, unavailable,
    shipsTo, invalid price, budget, missing seller or variant id (`invalid`).

        Attributes:
            offers (float):
            dropped_avoid (float):
            dropped_currency (float):
            dropped_unavailable (float):
            dropped_ships_to (float):
            dropped_budget (float):
            dropped_invalid (float): Malformed price or missing seller/variant id.
            eligible (float):
            eligible_sellers (float): Distinct seller domains among eligible offers.
            picked (float): Sellers introduced (≤ the request's count).
    """

    offers: float
    dropped_avoid: float
    dropped_currency: float
    dropped_unavailable: float
    dropped_ships_to: float
    dropped_budget: float
    dropped_invalid: float
    eligible: float
    eligible_sellers: float
    picked: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        offers = self.offers

        dropped_avoid = self.dropped_avoid

        dropped_currency = self.dropped_currency

        dropped_unavailable = self.dropped_unavailable

        dropped_ships_to = self.dropped_ships_to

        dropped_budget = self.dropped_budget

        dropped_invalid = self.dropped_invalid

        eligible = self.eligible

        eligible_sellers = self.eligible_sellers

        picked = self.picked

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "offers": offers,
                "droppedAvoid": dropped_avoid,
                "droppedCurrency": dropped_currency,
                "droppedUnavailable": dropped_unavailable,
                "droppedShipsTo": dropped_ships_to,
                "droppedBudget": dropped_budget,
                "droppedInvalid": dropped_invalid,
                "eligible": eligible,
                "eligibleSellers": eligible_sellers,
                "picked": picked,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        offers = d.pop("offers")

        dropped_avoid = d.pop("droppedAvoid")

        dropped_currency = d.pop("droppedCurrency")

        dropped_unavailable = d.pop("droppedUnavailable")

        dropped_ships_to = d.pop("droppedShipsTo")

        dropped_budget = d.pop("droppedBudget")

        dropped_invalid = d.pop("droppedInvalid")

        eligible = d.pop("eligible")

        eligible_sellers = d.pop("eligibleSellers")

        picked = d.pop("picked")

        search_stats = cls(
            offers=offers,
            dropped_avoid=dropped_avoid,
            dropped_currency=dropped_currency,
            dropped_unavailable=dropped_unavailable,
            dropped_ships_to=dropped_ships_to,
            dropped_budget=dropped_budget,
            dropped_invalid=dropped_invalid,
            eligible=eligible,
            eligible_sellers=eligible_sellers,
            picked=picked,
        )

        search_stats.additional_properties = d
        return search_stats

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
