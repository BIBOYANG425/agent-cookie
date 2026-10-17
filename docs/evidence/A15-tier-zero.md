# A15 零接入投递 · P1

状态：**已实际尝试，BLOCKED / 未通过。** 2026-10-17 的原始证据、真实截图和命令见 [A15 实测记录](A15/README.md)。HTTP 验收仍为 `it.todo`，本记录不表示通过。

C13 的配置交付已核对：`fixtures/agents.json` 中 `sample-acme` 的类别为 `shoe`，能力为 `trail_shoes`，`chatEndpoint=http://127.0.0.1:8000/api/chat`。该地址匹配固定上游 fd4d592 的实际路由；投递方须先调用 `/api/session` 建立上游会话，再带 `X-Session-Id` 发送 JSON 并完整处理 SSE，详见 [blueprint README](../../examples/blueprint/README.md)。前缀由工作台按策略生成，fixture 不预置字段值消息。

用户已选择 blueprint 原有通用商品；原版没有鞋类。原 A15 的“首条回复包含 42 码”标准未修改，不能把通用商品路线标为此项通过。本次新 main 工作台确实生成了含 `shoe_size 42` 的前缀和一条回执，但投递被原版 API 以缺少 session header 拒绝。独立正确协议诊断也只有凭据错误 SSE，没有 assistant 回复；真实模型凭据和连续录屏仍缺。

本模板保留 v0.3 的 A15 标准。此前探索的[双 Sample storefront + live UCP](two-storefronts-and-ucp.md)：两店使用共用接入实现和独立身份，其真实 LLM 回复不等于本项的“原版零接入”。仅有前缀投递也不足以证明新路线的工作台读取、撤销或 note 隔离。此处编号、标题和标准不随演示路线重命名，不把新路线结果记为 A15 通过。

通过标准：原版 ACME 鞋店收到带文本前缀的第一条消息后，首条回复包含 42 码，且未改它任何代码。

## 执行与取证

1. 记录上游仓库来源、精确提交和运行前的工作树状态，证明运行的是原版 ACME。
2. 使用标为 `Sample` 的 42 码种子。投递文本和响应应经真实工作台 HTTP 路径产生，不手写预期回复。
3. v0.3 的 Tier 0 例外只允许该商家类别的 auto 字段值进入前缀；purpose 字段只列字段名，绝不放地址等值。每次投递写回执；Tier 1 以上仍只给字段名。
4. 保存实际首条消息、首条回复、对应投递回执和连续录屏。首条回复要出现 42 码，不能用后续追问补成。
5. 再记录上游工作树状态及 diff，确认 ACME 代码未改。预先改好代码或仅使用参考实现都不满足本项。

## 执行记录

| 内容 | 记录 |
| --- | --- |
| 日期 / 执行人 | 2026-10-17，C 线 Codex |
| 本项目提交 / ACME 上游提交 | `8c1a869fe9fc67c7d7a80dd09714d0a4d21b6954` / `fd4d59224ab96b43c6dc6888207c67b3bd5a24cf`；B SDK `04c6e108e43999a15cecf3093c45acd21673a74c` |
| 运行前后状态与 diff 路径 | [baseline.json](A15/baseline.json)、[after.json](A15/after.json)、[空 upstream.diff](A15/upstream.diff)；上游 clean，哈希未变 |
| 首条消息 / 首条回复证据路径 | [实际 Tier 0 请求及 401](A15/tier0-wire.jsonl)；没有 assistant 回复；[独立正确协议 SSE](A15/correct-protocol-probe.json) |
| 投递回执路径 | [workspace-attempt.json](A15/workspace-attempt.json)，`r_z3jje37d`，投递活动明确 `failed / attempts=1 status=401` |
| 录屏路径 | 未采集；没有连续录屏，不以截图替代 |
| auto 值与 purpose 字段检查 | [checks.json](A15/checks.json)：`shoe_size 42` 已进入实际前缀；地址只出现字段名及用途，未出现地址值 |
| 结果与判定理由 | BLOCKED / 未通过：真实投递 401；独立正确协议返回 HTTP 200 但 SSE 只有 error、无回复 |
| 失败 / 阻塞 / 限制 | session/header/SSE 适配未接；模型凭据缺失；原版无鞋；[真实页面错误截图](A15/original-storefront-credential-error.jpg) 是独立 UI 诊断，不是 A15 成功路径 |
