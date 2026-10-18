from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="DreamingStats")


@_attrs_define
class DreamingStats:
    """
    Attributes:
        learned (float): Contributions written from observed conversations in this run.
        promoted (float): Card entries (field + value) that were not on the card at the previous run and are now.
        decayed (float): Fields in Card.decayed at this run's `now`.
        archived (float): Contribution lines moved to archive/ by compaction.
    """

    learned: float
    promoted: float
    decayed: float
    archived: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        learned = self.learned

        promoted = self.promoted

        decayed = self.decayed

        archived = self.archived

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "learned": learned,
                "promoted": promoted,
                "decayed": decayed,
                "archived": archived,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        learned = d.pop("learned")

        promoted = d.pop("promoted")

        decayed = d.pop("decayed")

        archived = d.pop("archived")

        dreaming_stats = cls(
            learned=learned,
            promoted=promoted,
            decayed=decayed,
            archived=archived,
        )

        dreaming_stats.additional_properties = d
        return dreaming_stats

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
