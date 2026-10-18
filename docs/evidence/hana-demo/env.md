# HANA isolated demo environment

Provisional preparation snapshot, not a live rehearsal freeze. No credentials are included.

```json
{
  "at": "2026-10-18T08:09:26Z",
  "hanaHead": "14392bb1613def16164485a9dbb9eefadc38f421",
  "cookieHead": "ac77221d0114d564ea5c84670f0fcee59cbbc5d0",
  "hanaEnvNames": [
    "DATABASE_URL",
    "OPENROUTER_API_KEY",
    "AGENT_MODEL",
    "AGENT_CHINESE_MODEL",
    "OBSERVER_MODEL",
    "RE_REACH_MODEL",
    "RELATIONSHIP_MODEL",
    "SPONTANEOUS_DISABLED",
    "HANA_DEMO_INSTANT",
    "HANA_BOSS_SCHEMA"
  ],
  "workspaceEnvNames": [],
  "snapshot": "/Users/cyrusgu/Desktop/LA hacks/HANA-new/.runtime/hana-step0-pre-demo.dump",
  "snapshotSha256": "aa11b17ec5a0c95246aea04b92920bb03d693db4794ef9f79c0c5c531db9e9f2",
  "note": "New isolated HANA database only; original workspace/phone DB and cursor untouched. Runtime code not yet frozen; source commits updated at rehearsal.",
  "hanaPatchSha256": "9c46a939751be05518788a0d51e060a6e4ff0224ccf536c4d8eaa5e451b8c916",
  "workspaceStatus": "Dedicated HANA demo workspace and key not yet provisioned; names pending",
  "codeStatus": "Local implementation verified; phone/environment not frozen",
  "hanaPatchGzipSha256": "a36fa05733c1cce76c7c8c86f54d9c39fa6e07ffc01b9130b182cf578d7aae62"
}
```

The original resetmem.sh hardcodes a different database and omits hana_messages and queued jobs. It has not been run. The guarded demo reset script requires isolated PostgreSQL and workspace port4314, snapshots first and retains cursor/traces. No personal relationship data was imported.

## Live setup snapshot — 2026-10-18 10:45 PDT

Supersedes the provisional missing-workspace status above; it does not certify the unfinished rehearsal. Values remain local.

```json
{
  "capturedAt": "2026-10-18T17:45:06.087425+00:00",
  "hanaHead": "3b5e416a1846f6e52d630577a51b7707ab34ed77",
  "cookieHead": "c6d56bdfa76d1c438312c02233dca3a3f9982cbb",
  "hanaEnvNames": [
    "AGENT_CHINESE_MODEL",
    "AGENT_COOKIE_DEMO_OWNER_KEY",
    "AGENT_COOKIE_KEY",
    "AGENT_COOKIE_URL",
    "AGENT_MODEL",
    "DATABASE_URL",
    "HANA_BOSS_SCHEMA",
    "HANA_DEMO_INSTANT",
    "HANA_EXPECTED_AGENT_ID",
    "HANA_ORIGINAL_CHANNEL_LOCK",
    "HANA_PHOTON_START_SEQ",
    "HANA_PHOTON_STATE",
    "MESSAGING_ALLOWED_ADDRESSES",
    "OBSERVER_MODEL",
    "OPENROUTER_API_KEY",
    "PHOTON_AGENT_HANDLE",
    "PHOTON_API_KEY",
    "PHOTON_PROJECT_ID",
    "RELATIONSHIP_MODEL",
    "RE_REACH_MODEL",
    "SPONTANEOUS_DISABLED"
  ],
  "workspaceEnvNames": [
    "AGENT_COOKIE_DATA_DIR",
    "AGENT_COOKIE_DEMO",
    "AGENT_COOKIE_LEARN_MODEL",
    "AGENT_COOKIE_LEARN_PROVIDER",
    "AGENT_COOKIE_PAY",
    "AGENT_COOKIE_TEST",
    "AGENT_COOKIE_UCP",
    "AGENT_COOKIE_URL",
    "DREAMING_INTERVAL_MS",
    "FIXTURES_DIR",
    "MEMORY_REPO_PATH",
    "OPENROUTER_API_KEY",
    "PORT",
    "SQLITE_PATH"
  ],
  "observerEnvNames": [
    "AGENT_COOKIE_CHANNEL_MODE",
    "AGENT_COOKIE_CHANNEL_START_SEQ",
    "AGENT_COOKIE_CHANNEL_STATE",
    "AGENT_COOKIE_DATA_DIR",
    "AGENT_COOKIE_DEMO",
    "AGENT_COOKIE_KEY",
    "AGENT_COOKIE_LEARNING_BINDING",
    "AGENT_COOKIE_LEARN_MODEL",
    "AGENT_COOKIE_LEARN_PROVIDER",
    "AGENT_COOKIE_SAMPLE",
    "AGENT_COOKIE_TEST",
    "AGENT_COOKIE_UCP",
    "AGENT_COOKIE_URL",
    "DREAMING_INTERVAL_MS",
    "PHOTON_AGENT_HANDLE",
    "PHOTON_API_KEY",
    "PHOTON_PLATFORM",
    "PHOTON_PROJECT_ID",
    "PHOTON_TEST_SENDER"
  ],
  "preCutoverSnapshot": "/Users/cyrusgu/Desktop/LA hacks/HANA-new/.runtime/snapshots/2026-10-18T17-21-25-321Z.dump",
  "snapshotSha256": "57e504026ea08ea1c4fe36db16708a7ff06b7ff688cd09542407afeff1590605",
  "state": "HANA is the only responder; observer is listen-only. Dedicated4314 UCP live/pay off. Current preference-only phone turn awaits natural five-minute learning; not a completed rehearsal or final freeze."
}
```

## Final demo handoff — 2026-10-18

HANA commit `2886cde` includes the fixed English phone replies. The distributed patch has been regenerated from baseline `045866f` to this commit and passes `git apply --reverse --check` against the final HANA tree.

- Uncompressed patch SHA-256: `15763931350f94a6b13a1fb0873e3fce59c7c38c1bb690c5277e9a4eca68ffda`
- Gzip SHA-256: `50dd137b306fbaa4e14d56bc87e2bfa771f90cedc350db23e057248044030703`
- HANA has no configured remote; this patch is its delivery artifact, not a claim of a separate push.
- Console now honors an explicit loopback `AGENT_COOKIE_URL` and uses the demo owner key only on its server. The existing Desktop MCP client now targets4314 with its existing personal identity; its old local env has a private backup.
- The previous chat processes exited during handoff. The existing4314 data was reopened, without reset; console5173, one HANA responder and one listen-only observer were resumed. Dead lock PIDs were checked before their lock files were archived; saved cursor23977 was retained. The user explicitly authorized resuming the original owner-only iMessage conversation.
- The original4310 data was not modified. Live merchant inventory, seeded context fields and naturally learned candidates are distinct evidence.
