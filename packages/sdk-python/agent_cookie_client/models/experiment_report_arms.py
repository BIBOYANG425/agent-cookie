from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.experiment_arm_stats import ExperimentArmStats


T = TypeVar("T", bound="ExperimentReportArms")


@_attrs_define
class ExperimentReportArms:
    """
    Attributes:
        control (ExperimentArmStats): One arm of an experiment. Counts only.
        treatment (ExperimentArmStats): One arm of an experiment. Counts only.
    """

    control: ExperimentArmStats
    treatment: ExperimentArmStats
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        control = self.control.to_dict()

        treatment = self.treatment.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "control": control,
                "treatment": treatment,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.experiment_arm_stats import ExperimentArmStats

        d = dict(src_dict)
        control = ExperimentArmStats.from_dict(d.pop("control"))

        treatment = ExperimentArmStats.from_dict(d.pop("treatment"))

        experiment_report_arms = cls(
            control=control,
            treatment=treatment,
        )

        experiment_report_arms.additional_properties = d
        return experiment_report_arms

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
