from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.shadow_report_changed_item import ShadowReportChangedItem


T = TypeVar("T", bound="ShadowReport")


@_attrs_define
class ShadowReport:
    """Response of POST /personal/policy/shadow: every past release (receipt) and every logged field read re-evaluated
    under a candidate document, compared with the installed one. Ids, field NAMES and decision codes only.

        Attributes:
            candidate_id (str):
            current_id (str):
            changed (list[ShadowReportChangedItem]):
            unchanged (float): (ref, field) pairs whose decision is the same under both documents.
    """

    candidate_id: str
    current_id: str
    changed: list[ShadowReportChangedItem]
    unchanged: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        candidate_id = self.candidate_id

        current_id = self.current_id

        changed = []
        for changed_item_data in self.changed:
            changed_item = changed_item_data.to_dict()
            changed.append(changed_item)

        unchanged = self.unchanged

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "candidateId": candidate_id,
                "currentId": current_id,
                "changed": changed,
                "unchanged": unchanged,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.shadow_report_changed_item import ShadowReportChangedItem

        d = dict(src_dict)
        candidate_id = d.pop("candidateId")

        current_id = d.pop("currentId")

        changed = []
        _changed = d.pop("changed")
        for changed_item_data in _changed:
            changed_item = ShadowReportChangedItem.from_dict(changed_item_data)

            changed.append(changed_item)

        unchanged = d.pop("unchanged")

        shadow_report = cls(
            candidate_id=candidate_id,
            current_id=current_id,
            changed=changed,
            unchanged=unchanged,
        )

        shadow_report.additional_properties = d
        return shadow_report

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
