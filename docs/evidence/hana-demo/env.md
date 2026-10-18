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
