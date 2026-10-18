# Phone → idle queue → real models → console, 2026-10-17

## Result and limit

The original Photon **2.0 Beta** iMessage line received the user's real non-sensitive preference, queued it via the SDK, and automatically wrote a conversation contribution after **5 min 19.209 sec**. OpenRouter's rendered Logs table independently shows **Jev 1.14 (TypeSafe)** and **gpt-oss-120b (Baseten)** at 18:52 PDT. The connected console displays the same conclusion, contribution ID and conversation ID returned by the actual SQLite backend.

**This is a partial acceptance, not a clean one-message candidate/promotion success.** Before the idle timer, the old reply classifier incorrectly treated the casual clothing sentence as shopping and created an intent. That immediate intent learned the same value. The later conversation contribution then supplied a second source ID for the **same utterance**, incorrectly promoting it. Do not present this screenshot as two independent conversations confirming a preference.

## Observed timeline (PDT)

| Time | Actual observation |
|---|---|
| 18:47:21.157 | `observation.queue`, one user turn; HTTP 202 followed at 18:47:21.164. Channel logs show queued → accepted. |
| 18:47:22.776 | Unwanted shopping-path contribution `c_2tgkeby2`, source intent `i_94fg3s6y`, basis observed, value `black, white, gray`; initially candidate. |
| 18:51:57 | Readback still has only the intent contribution. No conversation learning before the five-minute idle threshold. |
| 18:52:39.786 | Scheduled conversation contribution `c_0ggs1r0w`, basis observed; no manual flush or clock adjustment. |
| 18:52:40.366 | `learn.apply`, object conversation, written=1, field pref.color. |
| 18:52:40.632 | Dreaming completed; compact remains skipped because the C implementation is absent in this runtime. |
| 18:53 | Console and SDK readback agree; the two source IDs incorrectly promote the single utterance, as described above. |

The runtime used the same persistent demo data and original cursor/outbox. A full ignored local data backup was made before activating learning. The backend was not restarted during the five-minute wait. The single channel listener was gracefully restarted after all eight outgoing records were sent to load the routing fix; cursor 8427 and all records remained. No second message was requested from the user. Commerce remains fixture; no purchase/payment occurred.

## Real model evidence

Read-only OpenRouter Logs at 18:52 PDT show Jev input/output 544/127 tokens and gpt-oss input/output 445/147 tokens, with gpt-oss finish reason `stop`. Displayed costs are $0.0000228 + $0.000118 ≈ **$0.0001408** for the scheduled pass. These are rounded UI values, not an invoice. The table does not expose an HTTP code in this view; do not invent one. Both models also ran for the earlier erroneous intent at 18:47. No extra probe or replay was sent to a model during this investigation. Original message text, credentials and full model request/response bodies are not included in this evidence.

## Fix and verification

`6e30ae6` removes the product-noun/habitual-verb shopping fallback. Casual product preferences now receive a deterministic acknowledgment. A shopping request requires a request/imperative clause; an explicit request following a preference clause still works. Beta shopping requests use the existing intent learner and are not also queued as an independent observation source.

The added regression failed before the fix, then passed. **89 channel tests, channel typecheck and build passed.** PR #26/main `82b6864` was merged into B without changing A source. No real phone rerun of the corrected routing has occurred, so it is tested but not mislabeled as a second live success. The prior incorrect intent/contribution remain as evidence; they were not silently deleted. A/C should define correction without treating a routing error as a user privacy revocation (which may suppress future learning of the same value).

## UI boundary and remaining work

The console is connected to the real local workspace, using its configured owner bridge. Its Sample labels refer to the fixture-backed demo account. C currently also prints “上卡状态来自预设演示阶段” in this live view; that text is misleading for actual learned contributions and needs correction. B60 model provenance still awaits the formal contract/persistence/UI implementation. Neither label is altered for the screenshot.

![Actual console; duplicated-source promotion is a known defect, not acceptance of independent sources](2026-10-17-phone-learning-console.png)

Machine-readable metadata and screenshot digest: `2026-10-17-phone-learning-live.json`.
