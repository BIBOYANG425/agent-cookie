from enum import StrEnum


class Role(StrEnum):
    ASSISTANT = "assistant"
    MERCHANT = "merchant"
    OWNER = "owner"
    PERSONAL = "personal"

    def __str__(self) -> str:
        return str(self.value)
