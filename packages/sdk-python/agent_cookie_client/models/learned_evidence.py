from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.basis import Basis
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.evidence_models import EvidenceModels


T = TypeVar("T", bound="LearnedEvidence")


@_attrs_define
class LearnedEvidence:
    """One piece of evidence behind a learned value, as GET /personal/learned shows it.

    Attributes:
        contribution_id (str):
        agent_id (str):
        basis (Basis):
        created_at (str):
        intent_id (str | Unset):
        conversation_id (str | Unset):
        snippet (str | Unset):
        models (EvidenceModels | Unset): B60: the model ids behind a learned value — `gate`, the classifier that decided
            the turn may be learned from (e.g. Jev Decisions), and `extractor`, the model that produced the value. Each is
            an opaque model id of at most EVIDENCE_MODEL_ID_MAX characters from [A-Za-z0-9._:/@-]. Shown in GET
            /personal/learned; persisted on the contribution's memory-repo line as the open keys `gate:` / `extractor:`;
            RulesApi.mergeCard ignores it.
    """

    contribution_id: str
    agent_id: str
    basis: Basis
    created_at: str
    intent_id: str | Unset = UNSET
    conversation_id: str | Unset = UNSET
    snippet: str | Unset = UNSET
    models: EvidenceModels | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        contribution_id = self.contribution_id

        agent_id = self.agent_id

        basis = self.basis.value

        created_at = self.created_at

        intent_id = self.intent_id

        conversation_id = self.conversation_id

        snippet = self.snippet

        models: dict[str, Any] | Unset = UNSET
        if not isinstance(self.models, Unset):
            models = self.models.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "contributionId": contribution_id,
                "agentId": agent_id,
                "basis": basis,
                "createdAt": created_at,
            }
        )
        if intent_id is not UNSET:
            field_dict["intentId"] = intent_id
        if conversation_id is not UNSET:
            field_dict["conversationId"] = conversation_id
        if snippet is not UNSET:
            field_dict["snippet"] = snippet
        if models is not UNSET:
            field_dict["models"] = models

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.evidence_models import EvidenceModels

        d = dict(src_dict)
        contribution_id = d.pop("contributionId")

        agent_id = d.pop("agentId")

        basis = Basis(d.pop("basis"))

        created_at = d.pop("createdAt")

        intent_id = d.pop("intentId", UNSET)

        conversation_id = d.pop("conversationId", UNSET)

        snippet = d.pop("snippet", UNSET)

        _models = d.pop("models", UNSET)
        models: EvidenceModels | Unset
        if isinstance(_models, Unset):
            models = UNSET
        else:
            models = EvidenceModels.from_dict(_models)

        learned_evidence = cls(
            contribution_id=contribution_id,
            agent_id=agent_id,
            basis=basis,
            created_at=created_at,
            intent_id=intent_id,
            conversation_id=conversation_id,
            snippet=snippet,
            models=models,
        )

        learned_evidence.additional_properties = d
        return learned_evidence

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
