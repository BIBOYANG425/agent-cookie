from enum import StrEnum


class MintKeyResultRole(StrEnum):
    MERCHANT = "merchant"
    PERSONAL = "personal"

    def __str__(self) -> str:
        return str(self.value)
