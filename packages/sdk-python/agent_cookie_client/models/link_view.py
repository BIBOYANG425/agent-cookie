from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.link_status import LinkStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.link_view_jar import LinkViewJar


T = TypeVar("T", bound="LinkView")


@_attrs_define
class LinkView:
    """Assistant view (POST /assistant/link, GET /assistant/link/:id): never the owner's data, only the state of its own
    link.

        Attributes:
            id (str):
            status (LinkStatus):
            url (str): Where the owner decides: an ABSOLUTE URL of the workspace resource (`${jar}/owner/links/${id}`); a
                console or gateway renders it.
            expires_at (str):
            session_id (str | Unset): Present once approved.
            jar (LinkViewJar | Unset): Hosted gateway only (gateway.ts): present once approved, for LINK_TTL_MS after the
                approval (then purged). The person's instance under the gateway and the assistant's key for it. A single
                workspace never sets it.
    """

    id: str
    status: LinkStatus
    url: str
    expires_at: str
    session_id: str | Unset = UNSET
    jar: LinkViewJar | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        status = self.status.value

        url = self.url

        expires_at = self.expires_at

        session_id = self.session_id

        jar: dict[str, Any] | Unset = UNSET
        if not isinstance(self.jar, Unset):
            jar = self.jar.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "status": status,
                "url": url,
                "expiresAt": expires_at,
            }
        )
        if session_id is not UNSET:
            field_dict["sessionId"] = session_id
        if jar is not UNSET:
            field_dict["jar"] = jar

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.link_view_jar import LinkViewJar

        d = dict(src_dict)
        id = d.pop("id")

        status = LinkStatus(d.pop("status"))

        url = d.pop("url")

        expires_at = d.pop("expiresAt")

        session_id = d.pop("sessionId", UNSET)

        _jar = d.pop("jar", UNSET)
        jar: LinkViewJar | Unset
        if isinstance(_jar, Unset):
            jar = UNSET
        else:
            jar = LinkViewJar.from_dict(_jar)

        link_view = cls(
            id=id,
            status=status,
            url=url,
            expires_at=expires_at,
            session_id=session_id,
            jar=jar,
        )

        link_view.additional_properties = d
        return link_view

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
