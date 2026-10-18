from enum import StrEnum


class PrefField(StrEnum):
    PREF_AVOID = "pref.avoid"
    PREF_BRAND = "pref.brand"
    PREF_COLOR = "pref.color"
    PREF_FIT = "pref.fit"
    PREF_MATERIAL = "pref.material"
    PREF_OCCASION = "pref.occasion"
    PREF_PRICE_BAND = "pref.price_band"
    PREF_RECIPIENT = "pref.recipient"
    PREF_SIZE_SYSTEM = "pref.size_system"
    PREF_STYLE = "pref.style"

    def __str__(self) -> str:
        return str(self.value)
