from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.observation_turn import ObservationTurn


T = TypeVar("T", bound="Observation")


@_attrs_define
class Observation:
    """
    Attributes:
        channel (str): e.g. "imessage", "desktop".
        conversation_id (str): Opaque, chosen by the personal agent; stable across posts of one conversation.
        turns (list[ObservationTurn]):
    """

    channel: str
    conversation_id: str
    turns: list[ObservationTurn]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        channel = self.channel

        conversation_id = self.conversation_id

        turns = []
        for turns_item_data in self.turns:
            turns_item = turns_item_data.to_dict()
            turns.append(turns_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "channel": channel,
                "conversationId": conversation_id,
                "turns": turns,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.observation_turn import ObservationTurn

        d = dict(src_dict)
        channel = d.pop("channel")

        conversation_id = d.pop("conversationId")

        turns = []
        _turns = d.pop("turns")
        for turns_item_data in _turns:
            turns_item = ObservationTurn.from_dict(turns_item_data)

            turns.append(turns_item)

        observation = cls(
            channel=channel,
            conversation_id=conversation_id,
            turns=turns,
        )

        observation.additional_properties = d
        return observation

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
