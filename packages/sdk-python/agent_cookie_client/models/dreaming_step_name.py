from enum import StrEnum


class DreamingStepName(StrEnum):
    COMPACT = "compact"
    LEARN = "learn"
    LOG = "log"
    REGENERATE = "regenerate"

    def __str__(self) -> str:
        return str(self.value)
