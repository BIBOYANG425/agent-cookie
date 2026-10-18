from enum import StrEnum


class PolicyViewSource(StrEnum):
    DEFAULT = "default"
    INSTALLED = "installed"
    REPO = "repo"

    def __str__(self) -> str:
        return str(self.value)
