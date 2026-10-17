# Console scaffold

This is the H0 Sample preview, not the connected T6 console. It renders the three source contributions from `fixtures/contributions.json`; it does not merge records or invent grants, activity, receipts, or successful revocations.

```sh
# Node 22.12+ within Node 22
pnpm --dir apps/console install --ignore-workspace
pnpm --dir apps/console dev
pnpm --dir apps/console build
```

Development binds to `127.0.0.1:5173` with a strict port. No API key or environment variables are needed for the Sample preview. Do not put `AGENT_COOKIE_KEY` into `VITE_*` variables or a committed browser bundle.

Design: white source-record sheet on pale blue (`#f7f9fc`), navy text (`#263758`), blue actions (`#254fd8`), green Sample label (`#dfece7`), secondary slate (`#667189`). Native Chinese system typography, left-aligned field/value/source rows, one expandable source per record. This makes provenance the main interaction. No decorative metrics, unused navigation, or pretend action buttons.

After A supplies the frozen contract and fake workspace, implement the three T6 views against its response shapes: card with per-contribution revoke; `GET /personal/grants` with agent, fields, purpose, time remaining and revoke; reverse chronological activity with reason; top-level demo reset; poll every two seconds without overlapping requests. Use B's SDK when delivered (temporary HTTP is authorized by the user). Keep credentials at the local server boundary. H6 must be verified against the real workspace, not this preview.

Cross-line dependencies are in `docs/requests.md`. The root workspace configuration is owned elsewhere and intentionally untouched.
