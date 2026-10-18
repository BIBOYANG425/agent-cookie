from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.policy_view_source import PolicyViewSource

if TYPE_CHECKING:
    from ..models.policy_document import PolicyDocument


T = TypeVar("T", bound="PolicyView")


@_attrs_define
class PolicyView:
    """Response of GET /personal/policy. `source`: where the installed document came from.

    Attributes:
        policy (PolicyDocument): v1: today's POLICY.yaml shape. Field order inside the arrays is significant (handshake
            `available`, Tier 0 prefix).
        policy_id (str):
        source (PolicyViewSource): "default" = compiled DEFAULT_POLICY; "repo" = POLICY.yaml in the memory repo;
            "installed" = PUT by the owner, held in SQLite.
    """

    policy: PolicyDocument
    policy_id: str
    source: PolicyViewSource
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        policy = self.policy.to_dict()

        policy_id = self.policy_id

        source = self.source.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "policy": policy,
                "policyId": policy_id,
                "source": source,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.policy_document import PolicyDocument

        d = dict(src_dict)
        policy = PolicyDocument.from_dict(d.pop("policy"))

        policy_id = d.pop("policyId")

        source = PolicyViewSource(d.pop("source"))

        policy_view = cls(
            policy=policy,
            policy_id=policy_id,
            source=source,
        )

        policy_view.additional_properties = d
        return policy_view

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
