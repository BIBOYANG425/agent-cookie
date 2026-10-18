from enum import StrEnum


class ReadDecision(StrEnum):
    ALLOW = "allow"
    PURPOSE_MISMATCH = "PURPOSE_MISMATCH"
    SCOPE_DENIED = "SCOPE_DENIED"

    def __str__(self) -> str:
        return str(self.value)
