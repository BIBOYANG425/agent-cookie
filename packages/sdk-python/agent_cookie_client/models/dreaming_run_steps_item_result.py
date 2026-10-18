from enum import StrEnum


class DreamingRunStepsItemResult(StrEnum):
    FAILED = "failed"
    OK = "ok"
    SKIPPED = "skipped"

    def __str__(self) -> str:
        return str(self.value)
