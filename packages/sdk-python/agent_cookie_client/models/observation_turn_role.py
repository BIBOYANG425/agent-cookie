from enum import StrEnum


class ObservationTurnRole(StrEnum):
    AGENT = "agent"
    OTHER = "other"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
