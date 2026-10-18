from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="AssistantStats")


@_attrs_define
class AssistantStats:
    """GET /assistant/stats: counts over the intents the calling assistant created (bring-your-own-agent plan §5).

    Attributes:
        intents (float): Intents this assistant created.
        quoted (float): Of those, intents that received at least one quote.
        accepted (float): Of those, intents whose user accepted a quote.
        completed (float): Of those, accepted intents whose result reached a terminal success (ordered or handoff).
        questions_skipped (float): Sum of FunnelRow.questionsSkipped over those intents.
        generated_at (str):
    """

    intents: float
    quoted: float
    accepted: float
    completed: float
    questions_skipped: float
    generated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        intents = self.intents

        quoted = self.quoted

        accepted = self.accepted

        completed = self.completed

        questions_skipped = self.questions_skipped

        generated_at = self.generated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "intents": intents,
                "quoted": quoted,
                "accepted": accepted,
                "completed": completed,
                "questionsSkipped": questions_skipped,
                "generatedAt": generated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        intents = d.pop("intents")

        quoted = d.pop("quoted")

        accepted = d.pop("accepted")

        completed = d.pop("completed")

        questions_skipped = d.pop("questionsSkipped")

        generated_at = d.pop("generatedAt")

        assistant_stats = cls(
            intents=intents,
            quoted=quoted,
            accepted=accepted,
            completed=completed,
            questions_skipped=questions_skipped,
            generated_at=generated_at,
        )

        assistant_stats.additional_properties = d
        return assistant_stats

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
