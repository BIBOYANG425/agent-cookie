from enum import StrEnum


class ExperimentArm(StrEnum):
    CONTROL = "control"
    TREATMENT = "treatment"

    def __str__(self) -> str:
        return str(self.value)
