from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.dreaming_run_steps_item_result import DreamingRunStepsItemResult
from ..models.dreaming_step_name import DreamingStepName
from ..types import UNSET, Unset

T = TypeVar("T", bound="DreamingRunStepsItem")


@_attrs_define
class DreamingRunStepsItem:
    """
    Attributes:
        step (DreamingStepName):
        result (DreamingRunStepsItemResult):
        reason (str | Unset):
    """

    step: DreamingStepName
    result: DreamingRunStepsItemResult
    reason: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        step = self.step.value

        result = self.result.value

        reason = self.reason

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "step": step,
                "result": result,
            }
        )
        if reason is not UNSET:
            field_dict["reason"] = reason

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        step = DreamingStepName(d.pop("step"))

        result = DreamingRunStepsItemResult(d.pop("result"))

        reason = d.pop("reason", UNSET)

        dreaming_run_steps_item = cls(
            step=step,
            result=result,
            reason=reason,
        )

        dreaming_run_steps_item.additional_properties = d
        return dreaming_run_steps_item

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
