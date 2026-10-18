from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.basis import Basis
from ..types import UNSET, Unset

T = TypeVar("T", bound="MerchantContributionRequest")


@_attrs_define
class MerchantContributionRequest:
    """POST /agent/contributions body. A field outside the policy's write section, or a name outside the field table, is
    kept as the merchant's own "inferred" record and never reaches the card (A11), so `field` is any name here.

        Attributes:
            field (str): A Field name (at most 64 bytes).
            value (str): At most 512 UTF-8 bytes.
            basis (Basis | Unset):
            session_id (str | Unset): The session the fact is about; without it, this merchant's session with the user.
    """

    field: str
    value: str
    basis: Basis | Unset = UNSET
    session_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field

        value = self.value

        basis: str | Unset = UNSET
        if not isinstance(self.basis, Unset):
            basis = self.basis.value

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
        if session_id is not UNSET:
            field_dict["sessionId"] = session_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        field = d.pop("field")

        value = d.pop("value")

        _basis = d.pop("basis", UNSET)
        basis: Basis | Unset
        if isinstance(_basis, Unset):
            basis = UNSET
        else:
            basis = Basis(_basis)

        session_id = d.pop("sessionId", UNSET)

        merchant_contribution_request = cls(
            field=field,
            value=value,
            basis=basis,
            session_id=session_id,
        )

        merchant_contribution_request.additional_properties = d
        return merchant_contribution_request

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
