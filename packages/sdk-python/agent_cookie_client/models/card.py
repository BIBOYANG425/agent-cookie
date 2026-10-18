from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.data_source import DataSource
from ..models.field import Field
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.candidate import Candidate
    from ..models.card_field import CardField
    from ..models.superseded_field import SupersededField


T = TypeVar("T", bound="Card")


@_attrs_define
class Card:
    """Return shape of RulesApi.mergeCard and of GET /personal/card.

    Attributes:
        card (list[CardField]):
        candidates (list[Candidate]):
        superseded (list[SupersededField]): Values that used to be on the card and were replaced by a newer qualified
            value. History, not card.
        decayed (list[Field] | Unset): Additive (Dreaming, 2026-10-18; RulesApi.mergeCard fills it, lane C): fields
            that, at `now`, are held back purely by age — a card value downgraded to medium because lastSupportedAt is older
            than 180 days although it has two or more sources, or a field that left the card because its last support is
            older than 365 days. Pure: the same contributions and `now` give the same list. For logs only; never values.
        source (DataSource | Unset): Where a response's data comes from (lane B, B20). "sample" = Sample seed/demo data
            (fixtures); "fixture" = recorded upstream responses replayed (AGENT_COOKIE_UCP=fixture); "live" = real upstream
            calls or real agent input. Clients label "sample" and "fixture" data as Sample and never present them as live
            inventory or identity.
    """

    card: list[CardField]
    candidates: list[Candidate]
    superseded: list[SupersededField]
    decayed: list[Field] | Unset = UNSET
    source: DataSource | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        card = []
        for card_item_data in self.card:
            card_item = card_item_data.to_dict()
            card.append(card_item)

        candidates = []
        for candidates_item_data in self.candidates:
            candidates_item = candidates_item_data.to_dict()
            candidates.append(candidates_item)

        superseded = []
        for superseded_item_data in self.superseded:
            superseded_item = superseded_item_data.to_dict()
            superseded.append(superseded_item)

        decayed: list[str] | Unset = UNSET
        if not isinstance(self.decayed, Unset):
            decayed = []
            for decayed_item_data in self.decayed:
                decayed_item = decayed_item_data.value
                decayed.append(decayed_item)

        source: str | Unset = UNSET
        if not isinstance(self.source, Unset):
            source = self.source.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "card": card,
                "candidates": candidates,
                "superseded": superseded,
            }
        )
        if decayed is not UNSET:
            field_dict["decayed"] = decayed
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.candidate import Candidate
        from ..models.card_field import CardField
        from ..models.superseded_field import SupersededField

        d = dict(src_dict)
        card = []
        _card = d.pop("card")
        for card_item_data in _card:
            card_item = CardField.from_dict(card_item_data)

            card.append(card_item)

        candidates = []
        _candidates = d.pop("candidates")
        for candidates_item_data in _candidates:
            candidates_item = Candidate.from_dict(candidates_item_data)

            candidates.append(candidates_item)

        superseded = []
        _superseded = d.pop("superseded")
        for superseded_item_data in _superseded:
            superseded_item = SupersededField.from_dict(superseded_item_data)

            superseded.append(superseded_item)

        _decayed = d.pop("decayed", UNSET)
        decayed: list[Field] | Unset = UNSET
        if _decayed is not UNSET:
            decayed = []
            for decayed_item_data in _decayed:
                decayed_item = Field(decayed_item_data)

                decayed.append(decayed_item)

        _source = d.pop("source", UNSET)
        source: DataSource | Unset
        if isinstance(_source, Unset):
            source = UNSET
        else:
            source = DataSource(_source)

        card = cls(
            card=card,
            candidates=candidates,
            superseded=superseded,
            decayed=decayed,
            source=source,
        )

        card.additional_properties = d
        return card

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
