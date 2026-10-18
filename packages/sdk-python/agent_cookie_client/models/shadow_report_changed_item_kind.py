from enum import StrEnum


class ShadowReportChangedItemKind(StrEnum):
    READ = "read"
    RECEIPT = "receipt"

    def __str__(self) -> str:
        return str(self.value)
