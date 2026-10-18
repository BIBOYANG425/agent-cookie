from enum import StrEnum


class FunnelStage(StrEnum):
    ACCEPTED = "accepted"
    CHECKOUT = "checkout"
    COMPLETED = "completed"
    INTRODUCED = "introduced"
    PAYMENT = "payment"
    QUOTED = "quoted"

    def __str__(self) -> str:
        return str(self.value)
