from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.learned_entry_status import LearnedEntryStatus
from ..models.pref_field import PrefField

if TYPE_CHECKING:
    from ..models.learned_evidence import LearnedEvidence


T = TypeVar("T", bound="LearnedEntry")


@_attrs_define
class LearnedEntry:
    """GET /personal/learned: every `pref.*` value on the card ("card") or waiting for a second source ("candidate"), with
    who contributed it and why. RulesApi.mergeCard decides: the user's own statement ("stated") is on the card at once
    (medium); an observed or inferred value needs two independent sources — two different conversations or intents, not
    two agents.

        Attributes:
            field (PrefField):
            value (str):
            status (LearnedEntryStatus):
            sources (list[str]):
            evidence (list[LearnedEvidence]):
    """

    field: PrefField
    value: str
    status: LearnedEntryStatus
    sources: list[str]
    evidence: list[LearnedEvidence]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field.value

        value = self.value

        status = self.status.value

        sources = self.sources

        evidence = []
        for evidence_item_data in self.evidence:
            evidence_item = evidence_item_data.to_dict()
            evidence.append(evidence_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "field": field,
                "value": value,
                "status": status,
                "sources": sources,
                "evidence": evidence,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.learned_evidence import LearnedEvidence

        d = dict(src_dict)
        field = PrefField(d.pop("field"))

        value = d.pop("value")

        status = LearnedEntryStatus(d.pop("status"))

        sources = cast(list[str], d.pop("sources"))

        evidence = []
        _evidence = d.pop("evidence")
        for evidence_item_data in _evidence:
            evidence_item = LearnedEvidence.from_dict(evidence_item_data)

            evidence.append(evidence_item)

        learned_entry = cls(
            field=field,
            value=value,
            status=status,
            sources=sources,
            evidence=evidence,
        )

        learned_entry.additional_properties = d
        return learned_entry

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
