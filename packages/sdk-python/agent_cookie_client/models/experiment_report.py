from __future__ import annotations

from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.experiment_report_arms import ExperimentReportArms


T = TypeVar("T", bound="ExperimentReport")


@_attrs_define
class ExperimentReport:
    """Response of GET /owner/experiments. Computed from the stored arms, so it is reproducible from the database alone.
    `sample` is true unless the workspace talks to live merchants. No claim about lift belongs anywhere before each arm
    reaches the minimum n the plan states (docs/commerce-analytics-plan.md §6).

        Attributes:
            experiment (Literal['ranking']):
            arms (ExperimentReportArms):
            sample (bool):
            generated_at (str):
    """

    experiment: Literal["ranking"]
    arms: ExperimentReportArms
    sample: bool
    generated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        experiment = self.experiment

        arms = self.arms.to_dict()

        sample = self.sample

        generated_at = self.generated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "experiment": experiment,
                "arms": arms,
                "sample": sample,
                "generatedAt": generated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.experiment_report_arms import ExperimentReportArms

        d = dict(src_dict)
        experiment = cast(Literal["ranking"], d.pop("experiment"))
        if experiment != "ranking":
            raise ValueError(
                f"experiment must match const 'ranking', got '{experiment}'"
            )

        arms = ExperimentReportArms.from_dict(d.pop("arms"))

        sample = d.pop("sample")

        generated_at = d.pop("generatedAt")

        experiment_report = cls(
            experiment=experiment,
            arms=arms,
            sample=sample,
            generated_at=generated_at,
        )

        experiment_report.additional_properties = d
        return experiment_report

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
