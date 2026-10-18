from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.error_body_error import ErrorBodyError


T = TypeVar("T", bound="ErrorBody")


@_attrs_define
class ErrorBody:
    """Wire shape of every error response. Never includes field names the caller is not allowed to know.

    Attributes:
        error (ErrorBodyError):
        continue_url (str | Unset): Additive (A59, as UpstreamError.toBody sends it): UPSTREAM_ERROR only, the
            upstream's continue_url when it gave one.
    """

    error: ErrorBodyError
    continue_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error.to_dict()

        continue_url = self.continue_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "error": error,
            }
        )
        if continue_url is not UNSET:
            field_dict["continueUrl"] = continue_url

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.error_body_error import ErrorBodyError

        d = dict(src_dict)
        error = ErrorBodyError.from_dict(d.pop("error"))

        continue_url = d.pop("continueUrl", UNSET)

        error_body = cls(
            error=error,
            continue_url=continue_url,
        )

        error_body.additional_properties = d
        return error_body

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
