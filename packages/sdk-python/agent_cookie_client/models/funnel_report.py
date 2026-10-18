from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.funnel_row import FunnelRow


T = TypeVar("T", bound="FunnelReport")


@_attrs_define
class FunnelReport:
    """Response of GET /owner/funnel. `sample` is true unless the workspace talks to live merchants.

    Attributes:
        rows (list[FunnelRow]):
        sample (bool):
        generated_at (str):
    """

    rows: list[FunnelRow]
    sample: bool
    generated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        rows = []
        for rows_item_data in self.rows:
            rows_item = rows_item_data.to_dict()
            rows.append(rows_item)

        sample = self.sample

        generated_at = self.generated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "rows": rows,
                "sample": sample,
                "generatedAt": generated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.funnel_row import FunnelRow

        d = dict(src_dict)
        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = FunnelRow.from_dict(rows_item_data)

            rows.append(rows_item)

        sample = d.pop("sample")

        generated_at = d.pop("generatedAt")

        funnel_report = cls(
            rows=rows,
            sample=sample,
            generated_at=generated_at,
        )

        funnel_report.additional_properties = d
        return funnel_report

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
