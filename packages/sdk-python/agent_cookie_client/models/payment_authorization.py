from __future__ import annotations

from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.payment_authorization_status import PaymentAuthorizationStatus

T = TypeVar("T", bound="PaymentAuthorization")


@_attrs_define
class PaymentAuthorization:
    """
    Attributes:
        id (str):
        session_id (str):
        quote_id (str):
        amount (float):
        currency (Literal['USD']):
        status (PaymentAuthorizationStatus): `reversed` (additive): the hold was released at the provider because the
            store did not take the delegated payment (today's UCP adapter passes none to complete), so nothing remains held
            on the user's card.
        created_at (str):
    """

    id: str
    session_id: str
    quote_id: str
    amount: float
    currency: Literal["USD"]
    status: PaymentAuthorizationStatus
    created_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        quote_id = self.quote_id

        amount = self.amount

        currency = self.currency

        status = self.status.value

        created_at = self.created_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionId": session_id,
                "quoteId": quote_id,
                "amount": amount,
                "currency": currency,
                "status": status,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionId")

        quote_id = d.pop("quoteId")

        amount = d.pop("amount")

        currency = cast(Literal["USD"], d.pop("currency"))
        if currency != "USD":
            raise ValueError(f"currency must match const 'USD', got '{currency}'")

        status = PaymentAuthorizationStatus(d.pop("status"))

        created_at = d.pop("createdAt")

        payment_authorization = cls(
            id=id,
            session_id=session_id,
            quote_id=quote_id,
            amount=amount,
            currency=currency,
            status=status,
            created_at=created_at,
        )

        payment_authorization.additional_properties = d
        return payment_authorization

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
