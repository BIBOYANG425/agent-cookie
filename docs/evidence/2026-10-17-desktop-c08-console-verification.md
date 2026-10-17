# B 线：Claude Desktop、C08 记忆库与 C10 控制台联调

日期：2026-10-17。本文补充此前 `2026-10-17-sqlite-verification.md`，不覆盖历史状态。

## Claude Desktop 新后台验收已补齐

实际链路为 Claude Desktop → 本地 MCP → B SDK → `127.0.0.1:4310` 的 A Hono/SQLite 后台，使用 C 根 fixtures。用户在 Claude 中发送已准备的验收请求并确认结果已显示。

- 13:50:23 PDT：`get_my_card` 成功；后台记录 `sample-personal-desktop` 访问 `/personal/card`，状态 200。
- 13:50:31 PDT：`find_agents` 成功；对应 intent 创建 201、quotes 读取 200。桌面显示两条 Sample 报价，11995 / 10999 美分正确展示为 $119.95 / $109.99 USD。
- 原生界面与无障碍树显示 `lang=zh`、`tone=简短`、`shoe_size=42`。身份卡没有预算；120 来自本次查询参数。来源 `sample-personal-photon` 是贡献来源，不是本次调用身份。
- 两条 `etaDate=null`，Claude 明确无法保证周五前到；没有调用 `accept_quote`，没有下单。
- MCP 日志包含两次工具调用和对应成功返回，日志正文已脱敏；工具名/字段值以 UI 与匹配时间的后台记录共同核验，不从被隐藏的日志参数推断。

证据：`2026-10-17-claude-sqlite.json`（含协议时间、后台活动和截图哈希）、`2026-10-17-claude-sqlite-result.jpg`（原生窗口原图）。截图视口包含鞋码与完整报价；完整卡片字段另由原生无障碍树核对。

**范围：运行后台仍使用 A 的 stubRules/stubMemoryRepo/StubUcp。** 新 Desktop 验收证明实际桌面接上 SQLite 后台，不证明实时商家库存、真实付款或 Git 记忆持久化。该次 Sample ACME Tier 0 投递三次失败，活动中如实保留；未将其当成商家送达成功。

## 新 C 线代码及真实记忆库的隔离联调

本轮两次拉取 C：先合入 `23c7e5c`（C08，含 `a85471a`），后合入 `527ebd2`（C09/C10，含 `d58babb`）。截至本轮末次远端核查，A 仍为 `bd9d6e3`，D contract 仍为 `e34800f`，main 仍为 `8e48ea0`。

C08 已实现 `regenerateCard/resetToSeed`，此前 B23 的“C08 尚未实现”已解决。新增 B 集成测试 `packages/sdk/test/workspace-c-integration.test.ts` 在测试专用适配选择中接入真实 C rules 和 memory-repo，使用临时 SQLite 与临时 Git 目录：

1. 通过 SDK → A Hono 请求读取 C seed 的身份卡、创建意图并取得两条明确的 A StubUcp 报价。
2. 验证 A 调用真实 C `appendReceipt`，取得实际 Git commit SHA；SDK 读回 Tier 0 回执，没有 `memory.write` 失败。
3. 关闭并重新打开后台依赖，确认卡片与回执保留。

业务操作均通过 SDK；没有直接修改 SQLite 或业务记忆文件。测试使用 Hono `app.request` 的进程内 HTTP 入口，不声称这项测试经过网络或运行中的 4310 服务。没有改 A 的 `adapters.ts`，生产选择器仍需 A 接入真实 C 包。

## C10 控制台已连接本机当前后台

从 C 原样合入控制台，启动于 `127.0.0.1:5173`。通过页面密码输入框使用本地 demo owner 身份，走其固定 loopback 代理连接已有 4310 服务。没有在 URL、截图或本文件记录钥匙。

- 页面状态为“工作台 · 已连接”，身份卡显示 zh、简短、42。
- 显示实际数据库中的商家 grants、剩余时间和过期状态，不是默认页面内的 Sample A/B 两店数据。
- 活动面板找到同一条 13:50:23 的读卡记录；展开后执行者为 `sample-personal-desktop`，状态 200。还可看到本轮查报价与此前 iMessage handoff 活动。
- 本轮对已使用的演示数据库只做页面读取，没有点击撤销或 reset；C 自身的隔离 reset/revoke 验收见 `C10-console.md`，不冒充本轮重复通过。
- 截图：`2026-10-17-console-sqlite-card.jpg`、`2026-10-17-console-desktop-activity.jpg`。沿用浏览器默认视口，原图未改。

控制台目前仍使用 C 已标记的临时 HTTP adapter；尚未替换为 B SDK。真实来源撤销仍缺 contribution ID/记录载荷，不能把 agent ID 当作 contribution ID。根锁文件也尚未纳入 C 新增 vitest；本轮按 C README 用其独立冻结锁安装，未跨线改根锁。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| C memory-repo | 17 passed；typecheck 通过 |
| B SDK（含新 A+C 集成） | 39 passed；typecheck 通过 |
| C console | 12 passed；typecheck 与生产 build 通过 |
| Claude Desktop | 原生 UI、两次 MCP 调用与后台活动相互匹配 |
| 控制台浏览器 | 当前 4310 读卡、grants、Desktop 活动读取通过 |

控制台依赖的第一次离线安装因本机缓存缺 Vite 包而未完成，随后按冻结锁从 npm 安装成功，再完成上述检查。没有为了通过检查修改锁定版本。

## 后续分工

- A：把默认 adapters 切到 C rules/memory-repo 与 D UCP，统一根锁；仍需处理 B21/B22 的地址 seed、后缀尺码、fixture 覆盖和上游错误脱敏。
- A/C：冻结来源记录/贡献 ID 的读取载荷，之后 B 可在 SDK 暴露、C 接入真实来源撤销；B/C 继续统一控制台适配层。
- C：真实双店链路与 ACME 投递仍独立验收，不能以 UI 或两个 stub 报价替代。
- 本批只交付 lane-b；main 集成由团队负责人处理。当前 iMessage 与 Desktop 服务保留运行。
