from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.health_response_seed import HealthResponseSeed

T = TypeVar("T", bound="HealthResponse")


@_attrs_define
class HealthResponse:
    """GET /healthz: liveness for a supervisor such as the gateway; no key, no data. `seed` is AGENT_COOKIE_SEED.

    Attributes:
        ok (bool):
        seed (HealthResponseSeed):
    """

    ok: bool
    seed: HealthResponseSeed
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ok = self.ok

        seed = self.seed.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "ok": ok,
                "seed": seed,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        ok = d.pop("ok")

        seed = HealthResponseSeed(d.pop("seed"))

        health_response = cls(
            ok=ok,
            seed=seed,
        )

        health_response.additional_properties = d
        return health_response

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
