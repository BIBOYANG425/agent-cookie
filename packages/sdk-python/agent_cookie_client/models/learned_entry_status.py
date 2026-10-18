from enum import StrEnum


class LearnedEntryStatus(StrEnum):
    CANDIDATE = "candidate"
    CARD = "card"

    def __str__(self) -> str:
        return str(self.value)
