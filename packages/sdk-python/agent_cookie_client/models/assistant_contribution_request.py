from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.basis import Basis
from ..models.field import Field
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.assistant_evidence import AssistantEvidence


T = TypeVar("T", bound="AssistantContributionRequest")


@_attrs_define
class AssistantContributionRequest:
    """POST /assistant/contributions body: AssistantContributionInput plus the optional session, which must be the
    assistant's own (else 404).

        Attributes:
            field (Field):
            value (str):
            basis (Basis | Unset):
            evidence (AssistantEvidence | Unset): The evidence of an assistant's contribution: both fields required. Named
                (A59) so the JSON Schema keeps them required; the same shape as Required<Pick<ContributionEvidence,
                "conversationId" | "snippet">>.
            session_id (str | Unset):
    """

    field: Field
    value: str
    basis: Basis | Unset = UNSET
    evidence: AssistantEvidence | Unset = UNSET
    session_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field.value

        value = self.value

        basis: str | Unset = UNSET
        if not isinstance(self.basis, Unset):
            basis = self.basis.value

        evidence: dict[str, Any] | Unset = UNSET
        if not isinstance(self.evidence, Unset):
            evidence = self.evidence.to_dict()

        session_id = self.session_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "field": field,
                "value": value,
            }
        )
        if basis is not UNSET:
            field_dict["basis"] = basis
        if evidence is not UNSET:
            field_dict["evidence"] = evidence
        if session_id is not UNSET:
            field_dict["sessionId"] = session_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.assistant_evidence import AssistantEvidence

        d = dict(src_dict)
        field = Field(d.pop("field"))

        value = d.pop("value")

        _basis = d.pop("basis", UNSET)
        basis: Basis | Unset
        if isinstance(_basis, Unset):
            basis = UNSET
        else:
            basis = Basis(_basis)

        _evidence = d.pop("evidence", UNSET)
        evidence: AssistantEvidence | Unset
        if isinstance(_evidence, Unset):
            evidence = UNSET
        else:
            evidence = AssistantEvidence.from_dict(_evidence)

        session_id = d.pop("sessionId", UNSET)

        assistant_contribution_request = cls(
            field=field,
            value=value,
            basis=basis,
            evidence=evidence,
            session_id=session_id,
        )

        assistant_contribution_request.additional_properties = d
        return assistant_contribution_request

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
