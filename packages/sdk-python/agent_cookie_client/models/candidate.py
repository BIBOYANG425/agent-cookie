from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.candidate_reason import CandidateReason
from ..models.field import Field
from ..types import UNSET, Unset

T = TypeVar("T", bound="Candidate")


@_attrs_define
class Candidate:
    """
    Attributes:
        field (Field):
        value (str):
        sources (list[str]):
        reason (CandidateReason):
        evidence_sources (list[str] | Unset): As CardField.evidenceSources: independent conversations / intents behind
            this value (lane C fills it).
    """

    field: Field
    value: str
    sources: list[str]
    reason: CandidateReason
    evidence_sources: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field.value

        value = self.value

        sources = self.sources

        reason = self.reason.value

        evidence_sources: list[str] | Unset = UNSET
        if not isinstance(self.evidence_sources, Unset):
            evidence_sources = self.evidence_sources

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "field": field,
                "value": value,
                "sources": sources,
                "reason": reason,
            }
        )
        if evidence_sources is not UNSET:
            field_dict["evidenceSources"] = evidence_sources

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        field = Field(d.pop("field"))

        value = d.pop("value")

        sources = cast(list[str], d.pop("sources"))

        reason = CandidateReason(d.pop("reason"))

        evidence_sources = cast(list[str], d.pop("evidenceSources", UNSET))

        candidate = cls(
            field=field,
            value=value,
            sources=sources,
            reason=reason,
            evidence_sources=evidence_sources,
        )

        candidate.additional_properties = d
        return candidate

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
