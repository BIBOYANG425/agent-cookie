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

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.policy_document_auto import PolicyDocumentAuto
    from ..models.policy_document_history import PolicyDocumentHistory
    from ..models.policy_document_purpose import PolicyDocumentPurpose
    from ..models.policy_document_write import PolicyDocumentWrite
    from ..models.ranking_weights import RankingWeights


T = TypeVar("T", bound="PolicyDocument")


@_attrs_define
class PolicyDocument:
    """v1: today's POLICY.yaml shape. Field order inside the arrays is significant (handshake `available`, Tier 0 prefix).

    Attributes:
        v (Literal[1]):
        auto (PolicyDocumentAuto): Readable with the handshake, no purpose needed.
        purpose (PolicyDocumentPurpose): Readable only when the declared purpose is listed.
        write (PolicyDocumentWrite): Writable through contributions.
        ranking (RankingWeights | Unset): Integer weights 0–100 in the policy document (`ranking`). Both 0, or the
            section absent, means today's order: pinned, size, preferences, budget, catalog order. outcomeRank =
            −(round(winRate·winRate) − round(failRate·failure)), so sellers with equal history tie and catalog order still
            breaks the tie.
        history (PolicyDocumentHistory | Unset): Phase 4, optional: may read the person's intent and purchase history
            (GET /assistant/history for an assistant). Floor: personal always true, shoe and retail never; assistant is the
            owner's choice. Absent = personal only.
    """

    v: Literal[1]
    auto: PolicyDocumentAuto
    purpose: PolicyDocumentPurpose
    write: PolicyDocumentWrite
    ranking: RankingWeights | Unset = UNSET
    history: PolicyDocumentHistory | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        v = self.v

        auto = self.auto.to_dict()

        purpose = self.purpose.to_dict()

        write = self.write.to_dict()

        ranking: dict[str, Any] | Unset = UNSET
        if not isinstance(self.ranking, Unset):
            ranking = self.ranking.to_dict()

        history: dict[str, Any] | Unset = UNSET
        if not isinstance(self.history, Unset):
            history = self.history.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "v": v,
                "auto": auto,
                "purpose": purpose,
                "write": write,
            }
        )
        if ranking is not UNSET:
            field_dict["ranking"] = ranking
        if history is not UNSET:
            field_dict["history"] = history

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.policy_document_auto import PolicyDocumentAuto
        from ..models.policy_document_history import PolicyDocumentHistory
        from ..models.policy_document_purpose import PolicyDocumentPurpose
        from ..models.policy_document_write import PolicyDocumentWrite
        from ..models.ranking_weights import RankingWeights

        d = dict(src_dict)
        v = cast(Literal[1], d.pop("v"))
        if v != 1:
            raise ValueError(f"v must match const 1, got '{v}'")

        auto = PolicyDocumentAuto.from_dict(d.pop("auto"))

        purpose = PolicyDocumentPurpose.from_dict(d.pop("purpose"))

        write = PolicyDocumentWrite.from_dict(d.pop("write"))

        _ranking = d.pop("ranking", UNSET)
        ranking: RankingWeights | Unset
        if isinstance(_ranking, Unset):
            ranking = UNSET
        else:
            ranking = RankingWeights.from_dict(_ranking)

        _history = d.pop("history", UNSET)
        history: PolicyDocumentHistory | Unset
        if isinstance(_history, Unset):
            history = UNSET
        else:
            history = PolicyDocumentHistory.from_dict(_history)

        policy_document = cls(
            v=v,
            auto=auto,
            purpose=purpose,
            write=write,
            ranking=ranking,
            history=history,
        )

        policy_document.additional_properties = d
        return policy_document

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
