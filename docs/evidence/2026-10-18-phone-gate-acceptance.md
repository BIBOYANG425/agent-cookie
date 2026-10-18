# New-gate phone acceptance — interrupted run

Source gate `05a5d8f`, B evidence head `f788108`, human-merged main `35e8b56`. This report is an actual phone attempt, distinct from the earlier passing synthetic-input/model tests. All times below are Pacific time.

## Verified sequence

- Oct 17 **19:37:04.933**: one new owner phone turn entered the observation queue; event13928, followed by HTTP202. The channel advanced from cursor8515 / nine sent messages to cursor8843 / ten sent messages. There was no new shopping intent or premature contribution.
- **19:41:52**: still zero new contributions, as expected before the five-minute idle boundary.
- **19:42:00**: macOS power history records `Clamshell Sleep`. This was about five seconds before the earliest idle eligibility at19:42:04.933. The laptop briefly entered DarkWake at19:50:58 and slept again at19:51:10; the scheduled workspace log has a corresponding gap.
- Oct 18 **00:11:29**: read-only SDK verification still found only the prior color row and its two historical evidence records. **Zero new contribution** from this attempt. OpenRouter's refreshed Generations UI still ended at the prior19:13 test calls; no new generation for this phone attempt was observed.
- The original Photon process exhausted its bounded reconnects while offline and exited with `RECONNECT_FAILED`. Its state file was retained, all ten outbox records were `sent`, and its lock was released normally. The single replacement listener resumed cursor8843 and reported `channel_ready`, `learning:true`.

## Result and next acceptance

**Not passed.** A physical sleep interruption before the deadline is confirmed. The exact internal reason for returning no preference during later wake processing was not retained by the current LearnApi boundary; this evidence does not label it as a specific Jev rejection or invent an HTTP failure.

No original message was replayed, no manual flush/reset was used, and no additional diagnostic model request was sent. A new user-initiated attempt is pending. A temporary fifteen-minute idle-sleep inhibitor was started for that attempt; it does not bypass lid-close sleep. Keep the plugged-in laptop open throughout the natural idle wait. Existing learning data, credentials and channel state were preserved.

Machine-readable timestamps and sanitized state: [2026-10-18-phone-gate-acceptance.json](2026-10-18-phone-gate-acceptance.json). No original utterance, credential or full provider payload is included.
