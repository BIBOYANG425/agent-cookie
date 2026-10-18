from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="MerchantStats")


@_attrs_define
class MerchantStats:
    """Response of GET /agent/stats: the calling merchant's own history in this workspace, over its own `agent_id` only.
    Counts only: no session id, no field name or value, nothing about any other merchant.

        Attributes:
            sessions (float): Sessions the merchant holds (pairwise: one per user).
            returning_sessions (float): Of those, sessions introduced to more than one intent (the user came back).
            quotes (float): Quotes the merchant submitted (for a UCP store proxy, the quotes made from its catalog).
            accepted (float): Of those, quotes the user accepted (an accept that policy blocked is not counted).
            win_rate (float): accepted / quotes; 0 when there are no quotes.
            median_quote_ms (float | Unset): Median milliseconds from an intent's creation to this merchant's quote for it;
                absent when there are no quotes.
    """

    sessions: float
    returning_sessions: float
    quotes: float
    accepted: float
    win_rate: float
    median_quote_ms: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        sessions = self.sessions

        returning_sessions = self.returning_sessions

        quotes = self.quotes

        accepted = self.accepted

        win_rate = self.win_rate

        median_quote_ms = self.median_quote_ms

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessions": sessions,
                "returningSessions": returning_sessions,
                "quotes": quotes,
                "accepted": accepted,
                "winRate": win_rate,
            }
        )
        if median_quote_ms is not UNSET:
            field_dict["medianQuoteMs"] = median_quote_ms

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        sessions = d.pop("sessions")

        returning_sessions = d.pop("returningSessions")

        quotes = d.pop("quotes")

        accepted = d.pop("accepted")

        win_rate = d.pop("winRate")

        median_quote_ms = d.pop("medianQuoteMs", UNSET)

        merchant_stats = cls(
            sessions=sessions,
            returning_sessions=returning_sessions,
            quotes=quotes,
            accepted=accepted,
            win_rate=win_rate,
            median_quote_ms=median_quote_ms,
        )

        merchant_stats.additional_properties = d
        return merchant_stats

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
