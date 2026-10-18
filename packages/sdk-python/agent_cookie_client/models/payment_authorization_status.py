from enum import StrEnum


class PaymentAuthorizationStatus(StrEnum):
    AUTHORIZED = "authorized"
    DECLINED = "declined"
    REVERSED = "reversed"
    USED = "used"

    def __str__(self) -> str:
        return str(self.value)
