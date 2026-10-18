from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.policy_document_purpose_assistant import (
        PolicyDocumentPurposeAssistant,
    )
    from ..models.policy_document_purpose_personal import PolicyDocumentPurposePersonal
    from ..models.policy_document_purpose_retail import PolicyDocumentPurposeRetail
    from ..models.policy_document_purpose_shoe import PolicyDocumentPurposeShoe


T = TypeVar("T", bound="PolicyDocumentPurpose")


@_attrs_define
class PolicyDocumentPurpose:
    """Readable only when the declared purpose is listed.

    Attributes:
        personal (PolicyDocumentPurposePersonal):
        shoe (PolicyDocumentPurposeShoe):
        retail (PolicyDocumentPurposeRetail):
        assistant (PolicyDocumentPurposeAssistant):
    """

    personal: PolicyDocumentPurposePersonal
    shoe: PolicyDocumentPurposeShoe
    retail: PolicyDocumentPurposeRetail
    assistant: PolicyDocumentPurposeAssistant
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        personal = self.personal.to_dict()

        shoe = self.shoe.to_dict()

        retail = self.retail.to_dict()

        assistant = self.assistant.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "personal": personal,
                "shoe": shoe,
                "retail": retail,
                "assistant": assistant,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.policy_document_purpose_assistant import (
            PolicyDocumentPurposeAssistant,
        )
        from ..models.policy_document_purpose_personal import (
            PolicyDocumentPurposePersonal,
        )
        from ..models.policy_document_purpose_retail import PolicyDocumentPurposeRetail
        from ..models.policy_document_purpose_shoe import PolicyDocumentPurposeShoe

        d = dict(src_dict)
        personal = PolicyDocumentPurposePersonal.from_dict(d.pop("personal"))

        shoe = PolicyDocumentPurposeShoe.from_dict(d.pop("shoe"))

        retail = PolicyDocumentPurposeRetail.from_dict(d.pop("retail"))

        assistant = PolicyDocumentPurposeAssistant.from_dict(d.pop("assistant"))

        policy_document_purpose = cls(
            personal=personal,
            shoe=shoe,
            retail=retail,
            assistant=assistant,
        )

        policy_document_purpose.additional_properties = d
        return policy_document_purpose

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
