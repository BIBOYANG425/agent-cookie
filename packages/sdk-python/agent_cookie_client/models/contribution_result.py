from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.basis import Basis

if TYPE_CHECKING:
    from ..models.agent_contribution import AgentContribution


T = TypeVar("T", bound="ContributionResult")


@_attrs_define
class ContributionResult:
    """POST /agent/contributions and POST /assistant/contributions → 201.

    Attributes:
        stored (Basis):
        contribution (AgentContribution): The caller's own contribution record as stored (POST /agent/contributions,
            POST /assistant/contributions); never the user's id.
    """

    stored: Basis
    contribution: AgentContribution
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        stored = self.stored.value

        contribution = self.contribution.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "stored": stored,
                "contribution": contribution,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.agent_contribution import AgentContribution

        d = dict(src_dict)
        stored = Basis(d.pop("stored"))

        contribution = AgentContribution.from_dict(d.pop("contribution"))

        contribution_result = cls(
            stored=stored,
            contribution=contribution,
        )

        contribution_result.additional_properties = d
        return contribution_result

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
