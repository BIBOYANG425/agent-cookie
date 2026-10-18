from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="EvidenceModels")


@_attrs_define
class EvidenceModels:
    """B60: the model ids behind a learned value — `gate`, the classifier that decided the turn may be learned from (e.g.
    Jev Decisions), and `extractor`, the model that produced the value. Each is an opaque model id of at most
    EVIDENCE_MODEL_ID_MAX characters from [A-Za-z0-9._:/@-]. Shown in GET /personal/learned; persisted on the
    contribution's memory-repo line as the open keys `gate:` / `extractor:`; RulesApi.mergeCard ignores it.

        Attributes:
            gate (str | Unset):
            extractor (str | Unset):
    """

    gate: str | Unset = UNSET
    extractor: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        gate = self.gate

        extractor = self.extractor

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if gate is not UNSET:
            field_dict["gate"] = gate
        if extractor is not UNSET:
            field_dict["extractor"] = extractor

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        gate = d.pop("gate", UNSET)

        extractor = d.pop("extractor", UNSET)

        evidence_models = cls(
            gate=gate,
            extractor=extractor,
        )

        evidence_models.additional_properties = d
        return evidence_models

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
