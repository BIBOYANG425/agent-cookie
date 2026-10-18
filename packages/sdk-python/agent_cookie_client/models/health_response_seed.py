from enum import StrEnum


class HealthResponseSeed(StrEnum):
    BLANK = "blank"
    SAMPLE = "sample"

    def __str__(self) -> str:
        return str(self.value)
