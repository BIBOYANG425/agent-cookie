from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="RevokeKeyResult")


@_attrs_define
class RevokeKeyResult:
    """POST /owner/keys/:agentId/revoke: every live key of that agent is revoked at once; the agent, its contributions,
    sessions and receipts stay (revocation stops future reads, it does not recall what was already released). `revoked`
    counts the keys this call revoked (0 when none was live).

        Attributes:
            ok (bool):
            revoked_at (str):
            revoked (int):
    """

    ok: bool
    revoked_at: str
    revoked: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ok = self.ok

        revoked_at = self.revoked_at

        revoked = self.revoked

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "ok": ok,
                "revokedAt": revoked_at,
                "revoked": revoked,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        ok = d.pop("ok")

        revoked_at = d.pop("revokedAt")

        revoked = d.pop("revoked")

        revoke_key_result = cls(
            ok=ok,
            revoked_at=revoked_at,
            revoked=revoked,
        )

        revoke_key_result.additional_properties = d
        return revoke_key_result

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
