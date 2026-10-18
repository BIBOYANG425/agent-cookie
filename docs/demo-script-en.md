# Agent Cookie — English recording script

Target: 2:45–3:00, 1080p. All narration, captions, prompts, visible app labels, and terminal output must be English. Keep Sample and Fixture labels visible. Hide old chat sidebars and personal account details before recording.

## Recording sequence

| Time | Screen / action | Narration |
| --- | --- | --- |
| 0:00–0:20 | English console: Your context, sources, shoe size. | “Every time we switch AI assistants, we introduce ourselves again. Agent Cookie lets useful context travel with us, under our control.” |
| 0:20–0:50 | Existing English HANA phone conversation: shopping request, two offers, handoff. | “I can start on my phone. My assistant reads the context it is allowed to use, then asks merchants for offers. Here is the handoff to the selected store.” |
| 0:50–1:20 | Claude Desktop: read card, show two offers and receipts. | “Now I switch assistants. Claude Desktop reads the same Sample card and already knows my usual size. These are live search results; availability and fit still need checking.” |
| 1:20–1:55 | Company assistant Muse: request link, approve in Connections, show actual context. | “A company assistant asks to connect. I approve once. This is the context its model receives: allowed preferences, with shipping address and payment method excluded.” |
| 1:55–2:25 | Permissions / receipts, revoke Muse, show denied next read. | “I can inspect who read which fields and why. When I revoke this permission, the next read is refused. Revocation stops future access; it does not recall information already shared.” |
| 2:25–2:50 | Architecture / console hero. | “The workspace checks permissions with code, not a model's judgment. Separate merchant sessions preserve continuity as I switch assistants. Familiar to your agents. Always yours to control.” |

## Exact English prompts

Phone:
> Find me trail running shoes under $120. Reply in English.

Desktop (already verified):
> Use Agent Cookie to find trail running shoes. Reply in English. Read my card first; show usual size and two offers. Then compare merchant session IDs with earlier receipts. Keep Sample labels. Do not display addresses, accept, order, or pay.

## Match the narration to the footage

- The existing live workspace is port 4314; the console at 5173 connects to it. Do not reset it for recording.
- The phone persona is Sample, while the latest catalog searches are live. Label both dimensions.
- The current phone handoff did not release an address. Do not say it did.
- A fixture checkout may demonstrate purpose-gated address release only when its matching receipt is actually on screen. Label it “Sample · Fixture replay”.
- Claude Desktop is a personal-agent integration. Muse is a separately scoped company-assistant integration. Do not call the Desktop request a company-assistant consent flow.
- Merchant results can change between live searches. The latest Desktop search found different stores; stable sessions were visible in earlier matching receipts. Do not claim that those new stores reused the phone search's IDs.
- A learned candidate supported by one conversation is a candidate, not confirmed context. Do not imply multiple independent conversations.
- Without a Claude API greeting, say “This is the context its model receives.” Do not present a scripted greeting as a real model call.
- No paid order, real Visa authorization, or universal impossibility of cross-agent correlation is claimed.

## Recording fallback

If phone capture is unavailable, use the dated phone evidence briefly and spend the remaining time on the live English console and Desktop. If the company-assistant step is not recorded successfully, cut that segment and retain the verified personal-assistant switch. An edited video is acceptable as a walkthrough; do not describe it as one uninterrupted take.

Before submission: verify that the final video has English audio/captions, no Chinese sidebar or terminal text, readable UI at 1080p, correct Sample/Live labels, and a working YouTube or Vimeo link. The recording/upload owner and final link must be confirmed in the video chat.

## Verified company-assistant recording environment

The isolated Sample workspace is `http://127.0.0.1:4315`; its English console is `http://127.0.0.1:5174/?mode=live`. It uses fixture catalogs and payment is off. The original live phone workspace at 4314 is untouched.

The full sequence has now passed: approve Muse in the UI → actual context contains English, concise tone, size 42 and Brooks → same merchant sessions as Dots → fixture checkout releases the address to the selected merchant only → revoke Muse in the UI → next SDK context read returns 403 GRANT_REVOKED. See `docs/evidence/hana-demo/17-company-assistant-recording.json`.

For another take, from the delivery checkout (state remains only in a private temporary file):

```sh
node examples/assistant-sdk/demo-recording.mjs request-link
# On port 5174, approve the pending Sample Muse connection.
node examples/assistant-sdk/demo-recording.mjs context
# On port 5174, revoke Sample Muse under Permissions.
node examples/assistant-sdk/demo-recording.mjs verify-revoked
```

The helper prints actual Sample context and field-name receipts. It does not generate a model greeting or place a real order. Existing proof has Muse revoked; request a new link for the next take. Never run a reset against the original phone workspace.
