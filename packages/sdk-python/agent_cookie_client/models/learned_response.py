from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.learned_entry import LearnedEntry


T = TypeVar("T", bound="LearnedResponse")


@_attrs_define
class LearnedResponse:
    """
    Attributes:
        paused (bool):
        learned (list[LearnedEntry]):
    """

    paused: bool
    learned: list[LearnedEntry]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        paused = self.paused

        learned = []
        for learned_item_data in self.learned:
            learned_item = learned_item_data.to_dict()
            learned.append(learned_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "paused": paused,
                "learned": learned,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.learned_entry import LearnedEntry

        d = dict(src_dict)
        paused = d.pop("paused")

        learned = []
        _learned = d.pop("learned")
        for learned_item_data in _learned:
            learned_item = LearnedEntry.from_dict(learned_item_data)

            learned.append(learned_item)

        learned_response = cls(
            paused=paused,
            learned=learned,
        )

        learned_response.additional_properties = d
        return learned_response

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
