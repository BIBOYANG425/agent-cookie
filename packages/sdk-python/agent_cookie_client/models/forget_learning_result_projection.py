from enum import StrEnum


class ForgetLearningResultProjection(StrEnum):
    COMPLETE = "complete"
    PENDING = "pending"

    def __str__(self) -> str:
        return str(self.value)
