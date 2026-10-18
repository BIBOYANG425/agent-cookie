from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.field import Field

if TYPE_CHECKING:
    from ..models.dreaming_run_steps_item import DreamingRunStepsItem
    from ..models.dreaming_stats import DreamingStats


T = TypeVar("T", bound="DreamingRun")


@_attrs_define
class DreamingRun:
    """Response of POST /owner/dreaming/run (and what each scheduled run computes).

    Attributes:
        at (str):
        stats (DreamingStats):
        decayed_fields (list[Field]): Field names only.
        steps (list[DreamingRunStepsItem]):
    """

    at: str
    stats: DreamingStats
    decayed_fields: list[Field]
    steps: list[DreamingRunStepsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        at = self.at

        stats = self.stats.to_dict()

        decayed_fields = []
        for decayed_fields_item_data in self.decayed_fields:
            decayed_fields_item = decayed_fields_item_data.value
            decayed_fields.append(decayed_fields_item)

        steps = []
        for steps_item_data in self.steps:
            steps_item = steps_item_data.to_dict()
            steps.append(steps_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "at": at,
                "stats": stats,
                "decayedFields": decayed_fields,
                "steps": steps,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.dreaming_run_steps_item import DreamingRunStepsItem
        from ..models.dreaming_stats import DreamingStats

        d = dict(src_dict)
        at = d.pop("at")

        stats = DreamingStats.from_dict(d.pop("stats"))

        decayed_fields = []
        _decayed_fields = d.pop("decayedFields")
        for decayed_fields_item_data in _decayed_fields:
            decayed_fields_item = Field(decayed_fields_item_data)

            decayed_fields.append(decayed_fields_item)

        steps = []
        _steps = d.pop("steps")
        for steps_item_data in _steps:
            steps_item = DreamingRunStepsItem.from_dict(steps_item_data)

            steps.append(steps_item)

        dreaming_run = cls(
            at=at,
            stats=stats,
            decayed_fields=decayed_fields,
            steps=steps,
        )

        dreaming_run.additional_properties = d
        return dreaming_run

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
