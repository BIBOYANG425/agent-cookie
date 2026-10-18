from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.accept_result_status import AcceptResultStatus
from ..models.error_code import ErrorCode
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.payment_authorization import PaymentAuthorization
    from ..models.receipt import Receipt


T = TypeVar("T", bound="AcceptResult")


@_attrs_define
class AcceptResult:
    """Response of POST /personal/quotes/:id/accept.  ordered  = checkout completed; `orderId` set.  handoff  = UCP
    `requires_escalation`, or the store refusing to complete without the buyer signed in
    (INSUFFICIENT_PERMISSIONS / AUTH_REQUIRED; A17, confirmed): the user pays on the merchant's page;
    `continueUrl` is mandatory for UCP quotes.             This is the DEFAULT outcome — UCP stores mostly report
    native_checkout=false, so "can pay for             you" is never promised.  blocked  = policy refused a step (e.g.
    shipping_address → PURPOSE_MISMATCH); `code` set, nothing ordered.  failed   = upstream (ucp / Photon / payment
    provider) failed; `code` = UPSTREAM_ERROR; `continueUrl`             included whenever the upstream gave one. Never
    dressed up as success (A18).

        Attributes:
            status (AcceptResultStatus):
            quote_id (str):
            order_id (str | Unset):
            continue_url (str | Unset):
            message (str | Unset): Human-readable, passed through to the user verbatim (sold-out warnings, escalation
                reasons).
            code (ErrorCode | Unset): Error codes and their HTTP status: AUTH_REQUIRED 401, SCOPE_DENIED 403, GRANT_EXPIRED
                403, GRANT_REVOKED 403, PURPOSE_MISMATCH 403, NOT_FOUND 404, IDEMPOTENCY_CONFLICT 409, LINK_NOT_PENDING 409,
                MISSING_FIELD 422, UPSTREAM_ERROR 502, JAR_LOCKED 403, AUTHORIZATION_USED 403, OVER_BUDGET 403.
            receipts (list[Receipt] | Unset): Receipts written during this accept (who read which field for which purpose) —
                for telling the user.
            authorization (PaymentAuthorization | Unset):
    """

    status: AcceptResultStatus
    quote_id: str
    order_id: str | Unset = UNSET
    continue_url: str | Unset = UNSET
    message: str | Unset = UNSET
    code: ErrorCode | Unset = UNSET
    receipts: list[Receipt] | Unset = UNSET
    authorization: PaymentAuthorization | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        quote_id = self.quote_id

        order_id = self.order_id

        continue_url = self.continue_url

        message = self.message

        code: str | Unset = UNSET
        if not isinstance(self.code, Unset):
            code = self.code.value

        receipts: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.receipts, Unset):
            receipts = []
            for receipts_item_data in self.receipts:
                receipts_item = receipts_item_data.to_dict()
                receipts.append(receipts_item)

        authorization: dict[str, Any] | Unset = UNSET
        if not isinstance(self.authorization, Unset):
            authorization = self.authorization.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "status": status,
                "quoteId": quote_id,
            }
        )
        if order_id is not UNSET:
            field_dict["orderId"] = order_id
        if continue_url is not UNSET:
            field_dict["continueUrl"] = continue_url
        if message is not UNSET:
            field_dict["message"] = message
        if code is not UNSET:
            field_dict["code"] = code
        if receipts is not UNSET:
            field_dict["receipts"] = receipts
        if authorization is not UNSET:
            field_dict["authorization"] = authorization

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.payment_authorization import PaymentAuthorization
        from ..models.receipt import Receipt

        d = dict(src_dict)
        status = AcceptResultStatus(d.pop("status"))

        quote_id = d.pop("quoteId")

        order_id = d.pop("orderId", UNSET)

        continue_url = d.pop("continueUrl", UNSET)

        message = d.pop("message", UNSET)

        _code = d.pop("code", UNSET)
        code: ErrorCode | Unset
        if isinstance(_code, Unset):
            code = UNSET
        else:
            code = ErrorCode(_code)

        _receipts = d.pop("receipts", UNSET)
        receipts: list[Receipt] | Unset = UNSET
        if _receipts is not UNSET:
            receipts = []
            for receipts_item_data in _receipts:
                receipts_item = Receipt.from_dict(receipts_item_data)

                receipts.append(receipts_item)

        _authorization = d.pop("authorization", UNSET)
        authorization: PaymentAuthorization | Unset
        if isinstance(_authorization, Unset):
            authorization = UNSET
        else:
            authorization = PaymentAuthorization.from_dict(_authorization)

        accept_result = cls(
            status=status,
            quote_id=quote_id,
            order_id=order_id,
            continue_url=continue_url,
            message=message,
            code=code,
            receipts=receipts,
            authorization=authorization,
        )

        accept_result.additional_properties = d
        return accept_result

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
