from enum import StrEnum


class CardFieldConfidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"

    def __str__(self) -> str:
        return str(self.value)
