from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ObservationAck")


@_attrs_define
class ObservationAck:
    """POST /personal/observations → 202. `duplicate`: every turn was a replay (messageId already seen); nothing queued.

    Attributes:
        queued (bool):
        paused (bool | Unset):
        duplicate (bool | Unset):
    """

    queued: bool
    paused: bool | Unset = UNSET
    duplicate: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        queued = self.queued

        paused = self.paused

        duplicate = self.duplicate

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "queued": queued,
            }
        )
        if paused is not UNSET:
            field_dict["paused"] = paused
        if duplicate is not UNSET:
            field_dict["duplicate"] = duplicate

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        queued = d.pop("queued")

        paused = d.pop("paused", UNSET)

        duplicate = d.pop("duplicate", UNSET)

        observation_ack = cls(
            queued=queued,
            paused=paused,
            duplicate=duplicate,
        )

        observation_ack.additional_properties = d
        return observation_ack

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
