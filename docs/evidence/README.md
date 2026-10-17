# 验收证据索引

2026-10-17 起，**C14 只收集手动证据**。P0 自动项由 A 线的 [apps/workspace/test/acceptance](../../apps/workspace/test/acceptance) 维护，用户确认已执行 66/66；C 不在 `tests/acceptance` 重复扩写。该数字不替代 A10/A17 的真实客户端证据，未录制失败路径也应以 A 的最新报告单列。

| 编号 | 文件 / 入口 | 状态 |
| --- | --- | --- |
| A10 · Claude Desktop MCP（B） | [A10-real-client.md](A10-real-client.md) | 待 B 放入真实客户端截图 / 录屏与工作台活动；当前文件是证据模板 |
| A15 · 原版 ACME Tier 0（C） | [A15/README.md](A15/README.md) | 已实际尝试，**BLOCKED / 未通过**：工作台前缀含 42 并写回执，原版返回 401；正确协议诊断又遇模型凭据缺失，没有首条 assistant 回复 |
| A16 · Claude Code（C） | [A16/README.md](A16/README.md) | 独立实跑完成；新增 21 项测试、34/34 HTTP 步骤通过。有限 preferences/note 接入已验证；完整 MemoryStore 与全程录像仍缺，A16 BLOCKED |
| A16 · Devin（C / Devin） | [交接说明](A16/devin-brief.md) | 用户授权的[独立实跑](https://app.devin.ai/sessions/94dae4b1d11547c698d04be4119e41eb)完成；新增 10 项测试、29/29 HTTP 检查通过。完整 MemoryStore 未实现，A16 BLOCKED |
| A17 · iMessage 主流程（B） | [B 实际收发日志](https://github.com/BIBOYANG425/agent-cookie/blob/52321186803b9738a4aa956338af094679a12c7e/docs/evidence/2026-10-17-imessage-real-adapters.json)、[B 联调报告](https://github.com/BIBOYANG425/agent-cookie/blob/52321186803b9738a4aa956338af094679a12c7e/docs/evidence/2026-10-17-real-adapters-verification.md)、[原片待交项](A17-imessage.md) | PR #12 已交真实搜索 / 选择 / handoff 日志（三条 delivered、一次 accept 和 checkout 地址回执）；连续原片待 B，尚不标完整 A17 通过 |

A15 必须有原版首条回复中的 42 码、实际投递回执与运行前后代码未改证明。错误截图不能代替成功回复。A16 必须各自从干净克隆开始，由 Claude Code 和 Devin 独立应用 skill，并实际读到授权字段、写回本商家 note；仅基线测试、生成 diff 或部分录制不构成通过。C11 缺 note 枚举、删除、clear 等完整生命周期契约，保持 **P1 BLOCKED**，详见 [requests](../requests.md)。

## 历史与支撑证据

- [C14 HTTP 历史结果](C14-http-acceptance.md) / [机器结果](C14-http-results.json)：旧工作台基线 11 项规范 + 1 项支撑检查通过、11 todo，保留历史，不代表当前 A 自动套件状态。
- 控制台：[Sample 身份卡](C09-fixture-card.md)、[HTTP 展示/撤销/reset](C10-console.md)、[SDK 接线](C10b-sdk.md)、[320px 与键盘检查](C16-console-polish.md)。
- [TAP 库互通](2026-10-17-tap-interop.md)：独立签名互通记录，不代表工作台出站已签名。
- [双店与 UCP 取证说明](two-storefronts-and-ucp.md) 与 [早期脚手架](scaffold-verification.md) 保留原始上下文，不替代 A15/A16。

P0 = A01–A12、A17、A18、A22；P1 = A13–A16、A19–A21。各执行者提交真实文件、时间、commit、命令和判定理由。Sample 数据明确标 `Sample`，录制回放标 `Recorded run` 并注明数据模式。去掉钥匙、支付 token、完整地址和手机号；保留字段名、方法、状态与必要关联。用户已有 `docs/media/agent-cookie-demo.mp4` 尚未核验，不将其列为通过证据。
