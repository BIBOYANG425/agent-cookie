from enum import StrEnum


class CandidateReason(StrEnum):
    INFERRED = "inferred"
    SINGLE_SOURCE = "single_source"

    def __str__(self) -> str:
        return str(self.value)
