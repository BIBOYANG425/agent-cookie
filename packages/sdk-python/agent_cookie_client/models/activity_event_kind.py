from enum import StrEnum


class ActivityEventKind(StrEnum):
    DREAMING = "dreaming"
    RANK = "rank"
    SEARCH = "search"

    def __str__(self) -> str:
        return str(self.value)
