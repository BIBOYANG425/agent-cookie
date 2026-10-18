from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.data_source import DataSource
from ..models.experiment_arm import ExperimentArm
from ..models.funnel_row_outcome import FunnelRowOutcome
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.search_stats import SearchStats


T = TypeVar("T", bound="FunnelRow")


@_attrs_define
class FunnelRow:
    """One intent, from creation to its terminal outcome.

    Attributes:
        intent_id (str):
        created_at (str):
        source (DataSource): Where a response's data comes from (lane B, B20). "sample" = Sample seed/demo data
            (fixtures); "fixture" = recorded upstream responses replayed (AGENT_COOKIE_UCP=fixture); "live" = real upstream
            calls or real agent input. Clients label "sample" and "fixture" data as Sample and never present them as live
            inventory or identity.
        introduced (float): Merchants introduced (sessions attached to the intent, every channel).
        quoted (float): Distinct merchants that quoted.
        accepted (bool):
        fields_granted (float): Distinct field names in the grants issued for this intent (every merchant).
        fields_read (float): Distinct field names merchants actually read under those grants. fieldsRead / fieldsGranted
            is the minimization ratio.
        purpose_releases (float): Receipts written for this intent: purpose releases, handshake (auto-field) reads and
            Tier 0 deliveries.
        first_quote_ms (float | Unset): Milliseconds from intent creation to the first quote; absent when nobody quoted.
        outcome (FunnelRowOutcome | Unset): The accepted quote's terminal status, once there is one.
        search (SearchStats | Unset): What the hard filters did to one catalog search (apps/workspace ucp-filter: USD,
            ships to the user's country, available, the budget stated in this request, the card's learned `pref.avoid`).
            `offers` = eligible + every dropped bucket; an offer is counted in the first bucket that rejects it, checked in
            the order avoid, currency, unavailable, shipsTo, invalid price, budget, missing seller or variant id
            (`invalid`).
        created_by (str | Unset): Bring-your-own-agent: the agent (personal or assistant) that created the intent;
            absent on legacy rows.
        questions_skipped (float | Unset): Questions the user was not asked: the sum of field names across this intent's
            receipts (fields served to agents by policy at the stage that needed them). Counts only; it is the plan's
            measure of "skip onboarding".
        arm (ExperimentArm | Unset): The arm of a holdout experiment an intent is in. Assigned once, when the intent is
            created, and stored with it; an idempotent replay returns the stored intent and never reassigns. The rule is
            normative so anyone holding the user's secret can recompute it from the database: d = HMAC-SHA256(key = UTF-8
            user secret, message = UTF-8 intentId); the low bit of the digest's LAST byte, (d[31] & 1), 1 → "treatment", 0 →
            "control". Never sent to a merchant. E1 (AGENT_COOKIE_EXPERIMENT=ranking, and only while the installed policy
            document has non-zero `ranking` weights): treatment gets outcome-aware ranking, control gets today's order and
            no `ucp.rank` event.
    """

    intent_id: str
    created_at: str
    source: DataSource
    introduced: float
    quoted: float
    accepted: bool
    fields_granted: float
    fields_read: float
    purpose_releases: float
    first_quote_ms: float | Unset = UNSET
    outcome: FunnelRowOutcome | Unset = UNSET
    search: SearchStats | Unset = UNSET
    created_by: str | Unset = UNSET
    questions_skipped: float | Unset = UNSET
    arm: ExperimentArm | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        intent_id = self.intent_id

        created_at = self.created_at

        source = self.source.value

        introduced = self.introduced

        quoted = self.quoted

        accepted = self.accepted

        fields_granted = self.fields_granted

        fields_read = self.fields_read

        purpose_releases = self.purpose_releases

        first_quote_ms = self.first_quote_ms

        outcome: str | Unset = UNSET
        if not isinstance(self.outcome, Unset):
            outcome = self.outcome.value

        search: dict[str, Any] | Unset = UNSET
        if not isinstance(self.search, Unset):
            search = self.search.to_dict()

        created_by = self.created_by

        questions_skipped = self.questions_skipped

        arm: str | Unset = UNSET
        if not isinstance(self.arm, Unset):
            arm = self.arm.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "intentId": intent_id,
                "createdAt": created_at,
                "source": source,
                "introduced": introduced,
                "quoted": quoted,
                "accepted": accepted,
                "fieldsGranted": fields_granted,
                "fieldsRead": fields_read,
                "purposeReleases": purpose_releases,
            }
        )
        if first_quote_ms is not UNSET:
            field_dict["firstQuoteMs"] = first_quote_ms
        if outcome is not UNSET:
            field_dict["outcome"] = outcome
        if search is not UNSET:
            field_dict["search"] = search
        if created_by is not UNSET:
            field_dict["createdBy"] = created_by
        if questions_skipped is not UNSET:
            field_dict["questionsSkipped"] = questions_skipped
        if arm is not UNSET:
            field_dict["arm"] = arm

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.search_stats import SearchStats

        d = dict(src_dict)
        intent_id = d.pop("intentId")

        created_at = d.pop("createdAt")

        source = DataSource(d.pop("source"))

        introduced = d.pop("introduced")

        quoted = d.pop("quoted")

        accepted = d.pop("accepted")

        fields_granted = d.pop("fieldsGranted")

        fields_read = d.pop("fieldsRead")

        purpose_releases = d.pop("purposeReleases")

        first_quote_ms = d.pop("firstQuoteMs", UNSET)

        _outcome = d.pop("outcome", UNSET)
        outcome: FunnelRowOutcome | Unset
        if isinstance(_outcome, Unset):
            outcome = UNSET
        else:
            outcome = FunnelRowOutcome(_outcome)

        _search = d.pop("search", UNSET)
        search: SearchStats | Unset
        if isinstance(_search, Unset):
            search = UNSET
        else:
            search = SearchStats.from_dict(_search)

        created_by = d.pop("createdBy", UNSET)

        questions_skipped = d.pop("questionsSkipped", UNSET)

        _arm = d.pop("arm", UNSET)
        arm: ExperimentArm | Unset
        if isinstance(_arm, Unset):
            arm = UNSET
        else:
            arm = ExperimentArm(_arm)

        funnel_row = cls(
            intent_id=intent_id,
            created_at=created_at,
            source=source,
            introduced=introduced,
            quoted=quoted,
            accepted=accepted,
            fields_granted=fields_granted,
            fields_read=fields_read,
            purpose_releases=purpose_releases,
            first_quote_ms=first_quote_ms,
            outcome=outcome,
            search=search,
            created_by=created_by,
            questions_skipped=questions_skipped,
            arm=arm,
        )

        funnel_row.additional_properties = d
        return funnel_row

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
