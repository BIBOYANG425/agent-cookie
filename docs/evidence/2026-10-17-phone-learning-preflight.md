# Phone learning preflight — 2026-10-17

## Verified current configuration

- The logged-in Photon dashboard has the existing **Agent Cookie** free project and one person on its iMessage line. It is Photon **2.0 Beta**, with a `pho_prj_` project ID. The previously verified phone line is still configured. No line was created, migrated, removed, or messaged during this check.
- Local project environment files, relevant shell startup files, and standard Photon/Spectrum config locations were checked for **variable names/presence only**. The channel file contains the Beta project/API credentials. No configured Spectrum project ID/secret was found in the checked locations or the current process. This does not prove the user has no cloud project elsewhere. No secret value was printed or saved here.
- `app.photon.codes` (Spectrum Cloud) opens a login screen. The user has been asked to log in so existing cloud projects can be checked before creating anything. The active Beta browser session cannot establish the state of that separate dashboard.
- Installed `spectrum-ts` 12.11.0's Cloud provider requires its own project ID/secret. The official [version index](https://photon.codes/docs/llms.txt) documents distinct products, hosts and credentials: Spectrum `spectrum.photon.codes` / project-secret versus Beta `api.photon.codes/v1` / bearer token. A Beta key must not be relabeled as a Spectrum secret.
- Spectrum also documents [custom providers](https://photon.codes/docs/spectrum-ts/custom-platforms). A Beta-to-Spectrum adapter is a possible implementation, not an existing configured connection and not part of this check.

## Runtime boundary

The current phone listener still uses the Beta Socket.IO path. The implemented `serve-spectrum` path has not been activated. The checked channel state had seven sent records, cursor 6775, and no learning state. No listener was stopped, no second listener was started, and no cursor/outbox/database was reset. The real Jev + gpt-oss six-scenario result is separate from this pending phone → five-minute queue → console test.

## Independent work completed

A's B59 commit `2696fc8` was fast-forwarded into the B integration checkout without modifying A's source or tests. Its Jev Decisions + chat adapter test passed **3/3**, and workspace typecheck passed. No model request occurred in these checks. The README now has the Chinese defense explanation: a locally non-explicit turn excludes `stated` in the request schema, leaving observed/inferred candidates; post-response validation still applies.

B60's agreed models field is documented; it is not yet implemented in the checked A/C contract. PR #25's new CI result must be checked after pushing this update.
