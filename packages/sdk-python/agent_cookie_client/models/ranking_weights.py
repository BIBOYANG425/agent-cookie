from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="RankingWeights")


@_attrs_define
class RankingWeights:
    """Integer weights 0–100 in the policy document (`ranking`). Both 0, or the section absent, means today's order:
    pinned, size, preferences, budget, catalog order. outcomeRank = −(round(winRate·winRate) − round(failRate·failure)),
    so sellers with equal history tie and catalog order still breaks the tie.

        Attributes:
            win_rate (float):
            failure (float):
    """

    win_rate: float
    failure: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        win_rate = self.win_rate

        failure = self.failure

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "winRate": win_rate,
                "failure": failure,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        win_rate = d.pop("winRate")

        failure = d.pop("failure")

        ranking_weights = cls(
            win_rate=win_rate,
            failure=failure,
        )

        ranking_weights.additional_properties = d
        return ranking_weights

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
