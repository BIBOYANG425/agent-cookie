from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.basis import Basis
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.contribution_evidence import ContributionEvidence


T = TypeVar("T", bound="AgentContribution")


@_attrs_define
class AgentContribution:
    """The caller's own contribution record as stored (POST /agent/contributions, POST /assistant/contributions); never the
    user's id.

        Attributes:
            id (str):
            agent_id (str):
            field (str): A Field name, or the unknown name a merchant sent (kept as its own inferred record, A11).
            value (str):
            basis (Basis):
            created_at (str):
            revoked_at (str | Unset):
            evidence (ContributionEvidence | Unset): Where a learned contribution came from (additive, 2026-10-17).
                `snippet` is at most EVIDENCE_SNIPPET_MAX characters of the user's OWN words (never another party's), kept so
                the user can see why something was learned; the conversation it came from is not kept.
    """

    id: str
    agent_id: str
    field: str
    value: str
    basis: Basis
    created_at: str
    revoked_at: str | Unset = UNSET
    evidence: ContributionEvidence | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        agent_id = self.agent_id

        field = self.field

        value = self.value

        basis = self.basis.value

        created_at = self.created_at

        revoked_at = self.revoked_at

        evidence: dict[str, Any] | Unset = UNSET
        if not isinstance(self.evidence, Unset):
            evidence = self.evidence.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "agentId": agent_id,
                "field": field,
                "value": value,
                "basis": basis,
                "createdAt": created_at,
            }
        )
        if revoked_at is not UNSET:
            field_dict["revokedAt"] = revoked_at
        if evidence is not UNSET:
            field_dict["evidence"] = evidence

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.contribution_evidence import ContributionEvidence

        d = dict(src_dict)
        id = d.pop("id")

        agent_id = d.pop("agentId")

        field = d.pop("field")

        value = d.pop("value")

        basis = Basis(d.pop("basis"))

        created_at = d.pop("createdAt")

        revoked_at = d.pop("revokedAt", UNSET)

        _evidence = d.pop("evidence", UNSET)
        evidence: ContributionEvidence | Unset
        if isinstance(_evidence, Unset):
            evidence = UNSET
        else:
            evidence = ContributionEvidence.from_dict(_evidence)

        agent_contribution = cls(
            id=id,
            agent_id=agent_id,
            field=field,
            value=value,
            basis=basis,
            created_at=created_at,
            revoked_at=revoked_at,
            evidence=evidence,
        )

        agent_contribution.additional_properties = d
        return agent_contribution

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
