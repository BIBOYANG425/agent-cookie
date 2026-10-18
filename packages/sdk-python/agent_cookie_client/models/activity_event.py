from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.activity_event_kind import ActivityEventKind
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.dreaming_stats import DreamingStats
    from ..models.rank_stats import RankStats
    from ..models.search_stats import SearchStats


T = TypeVar("T", bound="ActivityEvent")


@_attrs_define
class ActivityEvent:
    """One activity row. Never contains field values.

    Attributes:
        id (str):
        at (str):
        event (str):
        actor (str):
        object_ (str):
        result (str):
        reason (str):
        kind (ActivityEventKind | Unset): Additive (2026-10-18): "dreaming" on events the periodic Dreaming job writes;
            "search" on the `ucp.search` event of an intent (docs/commerce-analytics-plan.md Phase 0); absent on request
            events.
        stats (DreamingStats | RankStats | SearchStats | Unset): Dreaming, search and rank events only: counts, never
            field values.
    """

    id: str
    at: str
    event: str
    actor: str
    object_: str
    result: str
    reason: str
    kind: ActivityEventKind | Unset = UNSET
    stats: DreamingStats | RankStats | SearchStats | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.dreaming_stats import DreamingStats
        from ..models.search_stats import SearchStats

        id = self.id

        at = self.at

        event = self.event

        actor = self.actor

        object_ = self.object_

        result = self.result

        reason = self.reason

        kind: str | Unset = UNSET
        if not isinstance(self.kind, Unset):
            kind = self.kind.value

        stats: dict[str, Any] | Unset
        if isinstance(self.stats, Unset):
            stats = UNSET
        elif isinstance(self.stats, DreamingStats) or isinstance(
            self.stats, SearchStats
        ):
            stats = self.stats.to_dict()
        else:
            stats = self.stats.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "at": at,
                "event": event,
                "actor": actor,
                "object": object_,
                "result": result,
                "reason": reason,
            }
        )
        if kind is not UNSET:
            field_dict["kind"] = kind
        if stats is not UNSET:
            field_dict["stats"] = stats

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.dreaming_stats import DreamingStats
        from ..models.rank_stats import RankStats
        from ..models.search_stats import SearchStats

        d = dict(src_dict)
        id = d.pop("id")

        at = d.pop("at")

        event = d.pop("event")

        actor = d.pop("actor")

        object_ = d.pop("object")

        result = d.pop("result")

        reason = d.pop("reason")

        _kind = d.pop("kind", UNSET)
        kind: ActivityEventKind | Unset
        if isinstance(_kind, Unset):
            kind = UNSET
        else:
            kind = ActivityEventKind(_kind)

        def _parse_stats(
            data: object,
        ) -> DreamingStats | RankStats | SearchStats | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                stats_type_0 = DreamingStats.from_dict(data)

                return stats_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                stats_type_1 = SearchStats.from_dict(data)

                return stats_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            stats_type_2 = RankStats.from_dict(data)

            return stats_type_2

        stats = _parse_stats(d.pop("stats", UNSET))

        activity_event = cls(
            id=id,
            at=at,
            event=event,
            actor=actor,
            object_=object_,
            result=result,
            reason=reason,
            kind=kind,
            stats=stats,
        )

        activity_event.additional_properties = d
        return activity_event

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
