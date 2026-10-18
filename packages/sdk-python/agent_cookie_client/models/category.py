from enum import StrEnum


class Category(StrEnum):
    ASSISTANT = "assistant"
    PERSONAL = "personal"
    RETAIL = "retail"
    SHOE = "shoe"

    def __str__(self) -> str:
        return str(self.value)
