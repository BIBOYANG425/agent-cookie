from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="ForgetResult")


@_attrs_define
class ForgetResult:
    """
    Attributes:
        revoked (float):
        contribution_ids (list[str]):
    """

    revoked: float
    contribution_ids: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        revoked = self.revoked

        contribution_ids = self.contribution_ids

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "revoked": revoked,
                "contributionIds": contribution_ids,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        revoked = d.pop("revoked")

        contribution_ids = cast(list[str], d.pop("contributionIds"))

        forget_result = cls(
            revoked=revoked,
            contribution_ids=contribution_ids,
        )

        forget_result.additional_properties = d
        return forget_result

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
