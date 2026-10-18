from enum import StrEnum


class GrantViewStatus(StrEnum):
    EXPIRED = "expired"
    LIVE = "live"
    REVOKED = "revoked"

    def __str__(self) -> str:
        return str(self.value)
