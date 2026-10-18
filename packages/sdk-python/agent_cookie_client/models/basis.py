from enum import StrEnum


class Basis(StrEnum):
    INFERRED = "inferred"
    OBSERVED = "observed"
    STATED = "stated"

    def __str__(self) -> str:
        return str(self.value)
