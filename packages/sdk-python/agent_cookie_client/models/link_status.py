from enum import StrEnum


class LinkStatus(StrEnum):
    APPROVED = "approved"
    DECLINED = "declined"
    EXPIRED = "expired"
    PENDING = "pending"

    def __str__(self) -> str:
        return str(self.value)
