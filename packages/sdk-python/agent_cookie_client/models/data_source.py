from enum import StrEnum


class DataSource(StrEnum):
    FIXTURE = "fixture"
    LIVE = "live"
    SAMPLE = "sample"

    def __str__(self) -> str:
        return str(self.value)
