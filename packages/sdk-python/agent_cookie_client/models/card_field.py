from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.card_field_confidence import CardFieldConfidence
from ..models.field import Field
from ..types import UNSET, Unset

T = TypeVar("T", bound="CardField")


@_attrs_define
class CardField:
    """
    Attributes:
        field (Field):
        value (str):
        confidence (CardFieldConfidence):
        sources (list[str]):
        updated_at (str):
        last_supported_at (str):
        changed_recently (bool):
        evidence_sources (list[str] | Unset): Learned values (B49, lane C fills it): canonical independent sources
            RulesApi.mergeCard counted for this value — distinct conversations / intents from evidence, not writers.
            `sources` stays the writers' agentIds.
    """

    field: Field
    value: str
    confidence: CardFieldConfidence
    sources: list[str]
    updated_at: str
    last_supported_at: str
    changed_recently: bool
    evidence_sources: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field.value

        value = self.value

        confidence = self.confidence.value

        sources = self.sources

        updated_at = self.updated_at

        last_supported_at = self.last_supported_at

        changed_recently = self.changed_recently

        evidence_sources: list[str] | Unset = UNSET
        if not isinstance(self.evidence_sources, Unset):
            evidence_sources = self.evidence_sources

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "field": field,
                "value": value,
                "confidence": confidence,
                "sources": sources,
                "updatedAt": updated_at,
                "lastSupportedAt": last_supported_at,
                "changedRecently": changed_recently,
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

        confidence = CardFieldConfidence(d.pop("confidence"))

        sources = cast(list[str], d.pop("sources"))

        updated_at = d.pop("updatedAt")

        last_supported_at = d.pop("lastSupportedAt")

        changed_recently = d.pop("changedRecently")

        evidence_sources = cast(list[str], d.pop("evidenceSources", UNSET))

        card_field = cls(
            field=field,
            value=value,
            confidence=confidence,
            sources=sources,
            updated_at=updated_at,
            last_supported_at=last_supported_at,
            changed_recently=changed_recently,
            evidence_sources=evidence_sources,
        )

        card_field.additional_properties = d
        return card_field

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
