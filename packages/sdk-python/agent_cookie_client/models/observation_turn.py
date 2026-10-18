from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.observation_turn_role import ObservationTurnRole
from ..types import UNSET, Unset

T = TypeVar("T", bound="ObservationTurn")


@_attrs_define
class ObservationTurn:
    """POST /personal/observations body: turns of a conversation the personal agent took part in or overheard. Only the
    user's own turns are ever learned from; "agent" and "other" turns are dropped on arrival. Turns are batched per
    (personal agent, conversationId); Dreaming learns from a batch once it has been quiet for OBSERVATION_IDLE_MS or
    holds OBSERVATION_BATCH_TURNS turns, never on arrival. The text is held in workspace memory only (B49): at most
    OBSERVATION_MAX_CONVERSATIONS conversations × OBSERVATION_MAX_QUEUED_TURNS turns, the oldest dropped (and counted in
    the activity log) past that; SQLite keeps only the conversationId, turn count and times, and a restart loses what
    was waiting. While learning is paused the observation is discarded.

        Attributes:
            role (ObservationTurnRole):
            text (str):
            at (str): ISO time the turn was said.
            message_id (str | Unset): Opaque id of the message on its channel (B49, optional). A turn whose messageId the
                same personal agent already posted within OBSERVATION_MESSAGE_TTL_MS is ignored, so a replay is not a second
                sighting.
    """

    role: ObservationTurnRole
    text: str
    at: str
    message_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        role = self.role.value

        text = self.text

        at = self.at

        message_id = self.message_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "role": role,
                "text": text,
                "at": at,
            }
        )
        if message_id is not UNSET:
            field_dict["messageId"] = message_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        role = ObservationTurnRole(d.pop("role"))

        text = d.pop("text")

        at = d.pop("at")

        message_id = d.pop("messageId", UNSET)

        observation_turn = cls(
            role=role,
            text=text,
            at=at,
            message_id=message_id,
        )

        observation_turn.additional_properties = d
        return observation_turn

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
