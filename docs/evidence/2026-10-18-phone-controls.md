# C console integration and phone pause/forget acceptance

## UI integration — verified

- Human-merged C PR #28 is main `18188fd`; merged into B as `2b2598c`. The requests-file conflict retained both lines' appended history. Existing phone evidence was retained.
- The running Vite console picked up C's source changes and was explicitly reconnected to the existing localhost4310 workspace. The backend and unique Photon listener were not restarted. No preference, pause state or channel cursor was changed by this integration.
- The real `pref.fit=loose` candidate `c_q1zxy8tw` now displays **记录、来源与证据**, the workspace-derived status explanation, and **typesafe/jev-1.14 → openai/gpt-oss-120b**. The previous incorrect preset-learning copy is absent from this connected learning section. The overall Sample-workspace label still correctly indicates the fixture-backed account/commerce environment.
- Read-only baseline at `2026-10-18T07:30:41.082Z`: backend and local channel learning both enabled; two learned rows (old color, new fit), three contribution records; channel cursor12523, eleven sent messages. Fit remains one observed candidate, not a confirmed card value.

## Checks

- C console: all 57 tests passed across focused runs, test typecheck and production build passed. The initial sandbox run blocked nine bridge tests from opening localhost sockets (`EPERM`); those same nine passed when rerun with local-listener permission, without code/assertion changes.
- B phone controls, capture and Beta integration: 34 tests passed.
- There is no new workspace, contract, rules, memory-repo, SDK, learn or phone runtime source change in the main-to-B merge. Existing phone/backend state remains intact.

## Real phone pause — verified

At **00:32:32.197 PDT**, the user's **暂停学习** command produced `learning.set` event17342 (`result:paused`) and `PUT /personal/learning` event17343 (HTTP200). The user confirmed receipt of “已暂停学习，后台已确认”. Readback at00:32:47 found backend `paused:true`, local capture `paused:true`, and all prior learned rows/evidence unchanged. The console switch was on and the learning section said “学习已暂停。已有记录仍保留”. Channel cursor advanced to12746, twelve sent outbox records. The control command did not create a learning observation or contribution.

## Remaining real phone steps — pending user input

1. User sends the same ordinary fit-preference sentence while paused. Verify the new message is handled, but dropped before the observation queue; do not infer this behavior solely from the paused switch. This request has been issued; no new phone message was observed through00:34:57 PDT.
2. After that readback, user sends **忘掉 版型**. The current target is the single `pref.fit=loose` candidate. Require the actual forget result, disappearance from current learned/card/candidates, preserved unrelated color, and learning remaining paused. Do not claim old Git history was erased (`historyErased:false`).

Paused-input suppression and real phone forget are not marked passed yet. No API mutation has been performed on the user's behalf to simulate either command. [Machine-readable evidence](2026-10-18-phone-controls.json) distinguishes completed and pending steps.

UI limitation retained for C: legacy rows without `models` currently render “本地规则”; missing metadata alone does not prove that an old record came from local rules. This does not affect the new fit row, whose two actual model IDs are present.

![Updated connected console showing actual model provenance](2026-10-18-phone-controls-ui-ready.png)

![Phone pause reflected in the console with existing preferences retained](2026-10-18-phone-controls-paused.png)
