from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ExperimentArmStats")


@_attrs_define
class ExperimentArmStats:
    """One arm of an experiment. Counts only.

    Attributes:
        n (float): Intents assigned this arm.
        accepted (float): Of those, intents with an accepted quote (an accept that policy blocked is not an accept).
        rate (float): accepted / n; 0 when n = 0.
        wilson95 (list[float]): Wilson score interval for `rate`, z = 1.96, clamped to [0, 1]; [0, 1] when n = 0.
        median_accept_ms (float | Unset): Median milliseconds from intent creation to its first accept; absent when
            nothing was accepted.
    """

    n: float
    accepted: float
    rate: float
    wilson95: list[float]
    median_accept_ms: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        n = self.n

        accepted = self.accepted

        rate = self.rate

        wilson95 = self.wilson95

        median_accept_ms = self.median_accept_ms

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "n": n,
                "accepted": accepted,
                "rate": rate,
                "wilson95": wilson95,
            }
        )
        if median_accept_ms is not UNSET:
            field_dict["medianAcceptMs"] = median_accept_ms

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        n = d.pop("n")

        accepted = d.pop("accepted")

        rate = d.pop("rate")

        wilson95 = cast(list[float], d.pop("wilson95"))

        median_accept_ms = d.pop("medianAcceptMs", UNSET)

        experiment_arm_stats = cls(
            n=n,
            accepted=accepted,
            rate=rate,
            wilson95=wilson95,
            median_accept_ms=median_accept_ms,
        )

        experiment_arm_stats.additional_properties = d
        return experiment_arm_stats

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
