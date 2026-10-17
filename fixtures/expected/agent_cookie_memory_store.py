"""Acceptance reference only: six-method, scoped Sample relationship memory.

Imports the pinned commerce-agents installation; no third-party source is vendored.
This is neither a Python workspace SDK nor a connected HTTP MemoryStore. The port
below is an in-process test seam, not an invented workspace API. Shared identity-card
fields are deliberately excluded: deleting a merchant fact must not delete the card.
"""
from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
import re
from types import MappingProxyType
from typing import Protocol

from commerce_common.fencing import Fence
from commerce_common.memory import MemoryWriteFilter, MemoryWriteRejected, match_facts, validate_fact, write_filter_for
from commerce_common.types import MemoryCategory, MemoryFact

# Frozen contract FIELDS, not a field-to-note mapping.
_CARD_FIELDS = frozenset({"lang", "tone", "length", "shoe_size", "budget", "deadline", "shipping_address", "payment_method"})
_RELATION_KEY = re.compile(r"[a-z0-9_.-]{1,64}\Z")
_SOURCE_TAG = re.compile(r"(?:[0-9a-f]{12}|-)\Z")


@dataclass(frozen=True)
class Scope:
    """Fixture-only namespace, created from trusted host configuration, never model input."""
    merchant_id: str
    pairwise_session_id: str


class ContractUnavailable(RuntimeError):
    """The HTTP capability has not been specified or implemented; no success is implied."""


class MemoryPort(Protocol):
    """Internal acceptance-test seam. These signatures are NOT workspace HTTP/SDK names."""
    def require_complete_contract(self) -> None: ...
    async def get_facts(self, scope: Scope) -> list[MemoryFact]: ...
    async def upsert_facts(self, scope: Scope, facts: list[MemoryFact]) -> None: ...
    async def search_facts(self, scope: Scope, query: str) -> list[MemoryFact]: ...
    async def delete_fact(self, scope: Scope, key: str) -> bool: ...
    async def clear(self, scope: Scope) -> None: ...
    async def purge_generation(self, scope: Scope) -> int: ...


class InMemoryFixturePort:
    """Single-process Sample storage. No HTTP, persistence, quota, or real authorization.

    The injected fixture gate runs for every operation. One lock serializes mutations;
    it does not make upstream's separate generation-check/write calls a distributed CAS.
    """
    def __init__(self, *, authorize: Callable[[Scope], None]) -> None:
        self._authorize = authorize
        self._facts: dict[Scope, dict[str, MemoryFact]] = {}
        self._generations: dict[Scope, int] = {}
        self._lock = asyncio.Lock()

    def require_complete_contract(self) -> None:
        # This port implements all six methods in memory; it makes no HTTP claim.
        return None

    async def get_facts(self, scope: Scope) -> list[MemoryFact]:
        async with self._lock:
            self._authorize(scope)
            return [fact.model_copy(deep=True) for fact in self._facts.get(scope, {}).values()]

    async def upsert_facts(self, scope: Scope, facts: list[MemoryFact]) -> None:
        async with self._lock:
            self._authorize(scope)
            # Validate/copy the entire batch before mutating, including direct port callers.
            batch = [MemoryFact.model_validate(fact.model_dump()).model_copy(deep=True) for fact in facts]
            bucket = self._facts.setdefault(scope, {})
            for fact in batch:
                bucket[fact.key] = fact

    async def search_facts(self, scope: Scope, query: str) -> list[MemoryFact]:
        return match_facts(await self.get_facts(scope), query)

    async def delete_fact(self, scope: Scope, key: str) -> bool:
        async with self._lock:
            self._authorize(scope)
            # Match upstream: only clear advances the subject's purge counter.
            return self._facts.get(scope, {}).pop(key, None) is not None

    async def clear(self, scope: Scope) -> None:
        async with self._lock:
            self._authorize(scope)
            self._facts.pop(scope, None)
            self._generations[scope] = self._generations.get(scope, 0) + 1

    async def purge_generation(self, scope: Scope) -> int:
        async with self._lock:
            self._authorize(scope)
            return self._generations.get(scope, 0)


class UnconnectedWorkspaceMemoryPort:
    """Fail closed until merchant HTTP defines the missing full-store operations.

    GET/PUT /agent/notes/:key exist, but internal MemoryRepoApi.deleteNote is not a
    merchant endpoint. Never substitute empty PUTs, /demo/reset, or local counters.
    """
    @staticmethod
    def require_complete_contract() -> None:
        raise ContractUnavailable(
            "TODO(contract): full HTTP MemoryStore needs note enumeration/codec, delete, "
            "clear, persistent generation and conditional-write semantics"
        )

    async def get_facts(self, scope: Scope) -> list[MemoryFact]:
        self.require_complete_contract()
        raise AssertionError("unreachable")

    async def upsert_facts(self, scope: Scope, facts: list[MemoryFact]) -> None:
        self.require_complete_contract()

    async def search_facts(self, scope: Scope, query: str) -> list[MemoryFact]:
        self.require_complete_contract()
        raise AssertionError("unreachable")

    async def delete_fact(self, scope: Scope, key: str) -> bool:
        self.require_complete_contract()
        raise AssertionError("unreachable")

    async def clear(self, scope: Scope) -> None:
        self.require_complete_contract()

    async def purge_generation(self, scope: Scope) -> int:
        self.require_complete_contract()
        raise AssertionError("unreachable")


class AgentCookieMemoryStore:
    """Six upstream methods over explicit, host-bound relationship facts.

    Only this merchant's approved context keys are writable. No fact is promoted to
    an observed contribution, and no shared card field is cached in relationship notes.
    Deployments still need a model-before-call authorization gate; upstream extraction
    catches storage errors and may otherwise let a turn continue.
    """
    def __init__(
        self, *, merchant_id: str, bindings: Mapping[str, str], port: MemoryPort,
        relation_keys: set[str] | frozenset[str], fence: Fence,
        write_filter: MemoryWriteFilter, clock: Callable[[], datetime],
    ) -> None:
        port.require_complete_contract()
        if not merchant_id or any(not subject or not pairwise for subject, pairwise in bindings.items()):
            raise ValueError("merchant and host bindings must be non-empty")
        if write_filter is None:
            raise ValueError("the original write filter is required")
        if any(key in _CARD_FIELDS or not _RELATION_KEY.fullmatch(key) for key in relation_keys):
            raise ValueError("relation keys must be explicit non-card keys")
        self._merchant = merchant_id
        self._bindings = MappingProxyType(dict(bindings))
        self._port = port
        self._relation_keys = frozenset(relation_keys)
        self._fence, self._filter, self._clock = fence, write_filter, clock

    def _scope(self, subject_id: str) -> Scope:
        pairwise = self._bindings.get(subject_id)
        if pairwise is None:
            raise PermissionError("unbound_subject")
        return Scope(self._merchant, pairwise)

    def _validated(self, candidate: MemoryFact) -> MemoryFact:
        fact = MemoryFact.model_validate(candidate.model_dump())
        if fact.source_session_id is not None and not _SOURCE_TAG.fullmatch(fact.source_session_id):
            raise MemoryWriteRejected("Not saved: provenance must be an upstream session tag.")
        # Retain the upstream fence, normalization and custom filter; never disable defaults.
        normalized = validate_fact(fact.key, fact.value, fact.category.value, fence=self._fence,
            write_filter=self._filter, source_session_id=fact.source_session_id)
        if write_filter_for().rejects(normalized.key, normalized.value):
            raise MemoryWriteRejected("Not saved: memory cannot contain account or contact identifiers.")
        if normalized.key not in self._relation_keys or normalized.category is not MemoryCategory.CONTEXT:
            raise MemoryWriteRejected("Not saved: only host-approved relationship context belongs in this fixture.")
        if not normalized.value:
            raise MemoryWriteRejected("Not saved: empty relationship context.")
        # validate_fact stamps wall time; replace that with original or explicitly injected time.
        return normalized.model_copy(update={"updated_at": fact.updated_at or self._clock()}, deep=True)

    async def get_facts(self, subject_id: str) -> list[MemoryFact]:
        return await self._port.get_facts(self._scope(subject_id))

    async def upsert_facts(self, subject_id: str, facts: list[MemoryFact]) -> None:
        scope = self._scope(subject_id)
        batch = [self._validated(fact) for fact in facts]
        await self._port.upsert_facts(scope, batch)

    async def search_facts(self, subject_id: str, query: str) -> list[MemoryFact]:
        return await self._port.search_facts(self._scope(subject_id), query)

    async def delete_fact(self, subject_id: str, key: str) -> bool:
        return await self._port.delete_fact(self._scope(subject_id), key)

    async def clear(self, subject_id: str) -> None:
        await self._port.clear(self._scope(subject_id))

    async def purge_generation(self, subject_id: str) -> int:
        return await self._port.purge_generation(self._scope(subject_id))
