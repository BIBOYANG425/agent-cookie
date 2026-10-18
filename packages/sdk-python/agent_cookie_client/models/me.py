from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.category import Category
from ..models.role import Role

T = TypeVar("T", bound="Me")


@_attrs_define
class Me:
    """Response of GET /me: three strings. An owner key reports category "personal" (it acts for the user) and role
    "owner".

        Attributes:
            agent_id (str):
            category (Category): pharmacy and hotel were cut on 2026-10-17; they come back after the hackathon, not before.
                "retail" (2026-10-17, human direction: search is driven by the user's own words): the category of UCP store
                proxies (`ucp:<domain>`), whatever they sell. Same policy as "shoe" (policy.ts). "shoe" stays for registered
                merchants that declared it.
            role (Role): category === "personal" ? "personal" : "merchant" for registered agents. "owner" is the user's own
                console/CLI key: it alone may call /owner/activity and /demo/reset (/demo/reset additionally requires
                AGENT_COOKIE_DEMO=1). Owner keys are not tied to a category; the fake workspace maps them from fixtures/dev-
                keys.json, the real one mints them at seed time.
    """

    agent_id: str
    category: Category
    role: Role
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        agent_id = self.agent_id

        category = self.category.value

        role = self.role.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "agentId": agent_id,
                "category": category,
                "role": role,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        category = Category(d.pop("category"))

        role = Role(d.pop("role"))

        me = cls(
            agent_id=agent_id,
            category=category,
            role=role,
        )

        me.additional_properties = d
        return me

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
