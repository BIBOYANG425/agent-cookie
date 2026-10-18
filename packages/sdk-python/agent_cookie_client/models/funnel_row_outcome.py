from enum import StrEnum


class FunnelRowOutcome(StrEnum):
    BLOCKED = "blocked"
    FAILED = "failed"
    HANDOFF = "handoff"
    ORDERED = "ordered"

    def __str__(self) -> str:
        return str(self.value)
