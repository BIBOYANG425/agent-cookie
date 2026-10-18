from enum import StrEnum


class KeyViewRole(StrEnum):
    MERCHANT = "merchant"
    PERSONAL = "personal"

    def __str__(self) -> str:
        return str(self.value)
