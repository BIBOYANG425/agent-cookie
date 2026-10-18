from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.forget_learning_result_projection import ForgetLearningResultProjection
from ..models.pref_field import PrefField

T = TypeVar("T", bound="ForgetLearningResult")


@_attrs_define
class ForgetLearningResult:
    """
    Attributes:
        field (PrefField):
        paused (bool):
        removed (float):
        projection (ForgetLearningResultProjection):
        history_erased (bool):
    """

    field: PrefField
    paused: bool
    removed: float
    projection: ForgetLearningResultProjection
    history_erased: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field.value

        paused = self.paused

        removed = self.removed

        projection = self.projection.value

        history_erased = self.history_erased

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "field": field,
                "paused": paused,
                "removed": removed,
                "projection": projection,
                "historyErased": history_erased,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        field = PrefField(d.pop("field"))

        paused = d.pop("paused")

        removed = d.pop("removed")

        projection = ForgetLearningResultProjection(d.pop("projection"))

        history_erased = d.pop("historyErased")

        forget_learning_result = cls(
            field=field,
            paused=paused,
            removed=removed,
            projection=projection,
            history_erased=history_erased,
        )

        forget_learning_result.additional_properties = d
        return forget_learning_result

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
