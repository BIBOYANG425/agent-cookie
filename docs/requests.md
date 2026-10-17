# 跨线请求

2026-10-17，B 线（Cyrus / Codex A）准备核查；基线 `7da6659`。待 A/C 核对并更新共享 Artifact 与冻结契约；本文件不代表接口已经改动。仅本地记录，尚未推送或转达。

| ID | 发起 → 接收 | 请求与依据 | 状态 |
| --- | --- | --- | --- |
| B01 | B → A/C | 请先交付根工作区/锁文件、SDK 导出与假工作台；明确根文件 owner、C 的 fixtures 交付位置。当前只有计划，B 无法按同一契约安装和接入。 | 待确认 |
| B02 | B → A | 补 Agent.role、key 与 user/agent 的服务端绑定及注册权限；商家声明 purpose=checkout 不能单独获得地址，须核对已接受 quote 对应 intent、agent、session 与有效授权。 | 待确认 |
| B03 | B → A/C | 补 Quote 的 seller/variant/金额单位/币种/可空 ETA，以及 accept 的 handoff URL、completed、failed 结果；现 pendingRequests 返回不足以支持 Photon 回复。握手含 lang/tone/length 值与 A04“无任何值”的冲突也需统一。 | 待确认 |
| B04 | B → A/C | UCP 0.9.1 只读实测：USD120 搜鞋总数379、首10商品9店，native_checkout 全 false，无配送时效，且出现 USD129/EUR 与不同尺码体系；须后验筛选。Reebok discovery 有 checkout 能力但不等于可付款；官方要求 Catalog JWT，create 使用 input.cart_id，不能假定 --cart-id 存在。 | 待验证 checkout，未创建订单 |
| B05 | B → C/A | 官方 ACME fd4d592 的 MemoryStore 有 get_facts/upsert_facts/search_facts/delete_fact/clear/purge_generation 六方法；需补删除与 purge 契约并保留写过滤。只给字段名的 Tier0 前缀不能保证原版首句知道42码。 | 待确认 |
| B06 | B → A/C | Photon 官方支持 Node Socket.IO 主动连接 /v1/projects/{projectId}/events/ws，可保留工作台 loopback；project:read 收事件、project:write 回复，重连需 cursor 与去重。需提供实际项目/通道配置并跑收发。 | 文档已核对，真实通道未验证 |
| B07 | B → A/C | 统一必要验收集合：表中 A13–A16 为 P1，出口又要求 A01–A18；确保最小控制台可撤销。根 .gitignore 忽略了 .env.example；引用的 docs/superpowers/specs/2026-10-12-demo-integration-ladder-design.md 缺失且被忽略。 | 待确认 |

来源：[UCP 官方](https://github.com/Shopify/ucp-cli)、[Photon Socket.IO](https://photon.codes/docs/beta/websocket/connect)、[ACME 固定源码](https://github.com/anthropics/commerce-agents/blob/fd4d59224ab96b43c6dc6888207c67b3bd5a24cf/commerce-common/commerce_common/memory.py)。B 线完整本地证据在仓库旁 `outputs/AgentCookie_Preflight_2026-10-17/`；环境准备、真实目录读请求、原版 ACME 基础启动已验证，主应用/MCP/Photon/checkout 尚未验证。

2026-10-17，B 线脚手架更新，已同步 main `d48e263`（计划 v0.3）。以下是对上面历史请求的补充，不覆盖原记录；仍仅本地、未推送。

| ID | 发起 → 接收 | 请求与依据 | 状态 |
| --- | --- | --- | --- |
| B08 | B → A/C | v0.3 已把 SDK/CLI 归 B，B01 中等待 A 交 SDK 的部分已失效。B 已实现 SDK `WorkspaceClient.getMe/getMyCard`、CLI `card`、MCP `get_my_card`。请 A 合入根工作区及可运行的假工作台，提供个人测试 key 的本地配置路径。 | B 本地链路已测；真实 A 工作台未联调 |
| B09 | B → 根文件 owner/A | 根 workspace 尚未进入 main；B 四个包暂独立锁依赖、SDK 用 `link:../sdk` 引用。根工作区合入后需统一锁文件和安装/构建流程；SDK 应先构建，CLI/MCP 再构建。请冻结时让 B 引用正式 core 类型，不维护第二份业务类型。 | 待根工作区与冻结类型 |
| B10 | B → A/C | v0.3 已修正 SDK 归属、callback type、Tier 0 值例外、P0 集合等。仍需冻结：Quote.price 单位、未知 ETA 表达、accept 返回的 completed/continue_url/失败 envelope，以及 owner 角色与 /demo/reset 权限（plan Role 只有 personal/merchant，但 A 的预版含 owner）。本轮只读卡，未猜这些写入接口。 | 阻塞后续完整购物接线，不阻塞本地脚手架 |
| B11 | B → A/C | 用户已确认 Photon 项目尚未创建，本轮只做本地脚手架。配置检查与 Sample demo 零外呼；真实探针默认只收，显式 --send 才回一条新 ping。Claude Desktop 手动验证、真实 Photon 收发及 A10/A17 均未完成。 | 下一步需 Photon 项目/通道与 A 工作台 |

2026-10-17，B 线交付批次：本文件随 SDK、CLI、MCP、Photon 脚手架和个人 agent skill 一并提交至 `lane-b`。上文“仅本地、未推送”保留为历史快照；远端交付以本批提交为准。代码验证结果：59 项自动测试通过，四个包类型检查与构建通过，7 项命令入口检查通过。当前主要交接请求见 B08–B11；真实工作台、Claude Desktop 和 Photon 收发仍待联调。合入 main 由团队负责人处理。

2026-10-17，A 线（Claude Code）交付：`packages/contract`（原 `packages/core`，冻结）+ 根工作区。按人的分工调整：A 只拥有 `packages/contract` 和 `apps/workspace`；merge/session/render 实现归 C（`packages/rules`），git 记忆库写入归 C（`packages/memory-repo`），UCP 调用归 D（`packages/ucp`），假工作台归 B（`apps/workspace-fake`），fixtures 用 C 的。以下只追加。

| ID | 发起 → 接收 | 请求与依据 | 状态 |
| --- | --- | --- | --- |
| A01 | A → 全部 | 契约包改名 `@agent-cookie/contract`（目录 `packages/contract`）。内容：`types.ts`（含 B10 要的冻结项：Quote.price 美分整数、currency "USD"、etaDate 可为 null + etaText、AcceptResult ordered/handoff/blocked/failed、Role 含 owner、A04 措辞）、`policy.ts`（purpose 放行还需该 session 的 intent 下有本 agent 已 accepted 的 quote，由工作台核对）、`errors.ts`（含 UpstreamError）、`endpoints.ts`、`tier0.ts`（前缀格式）、`apis.ts`（三个接口）、`fixtures.ts`（工作台读的 fixtures 文件名与形状）。请各线 `import type … from "@agent-cookie/contract"`，`"@agent-cookie/contract": "workspace:*"`，不维护第二份类型。 | 已交付 |
| A02 | A → C | `packages/rules` 实现 `RulesApi`（`mergeCard`、`deriveSessionId`、`renderCard`、`renderContribution`、`parseContributions`），签名和规则见 `packages/contract/src/apis.ts`；`deriveSessionId` 必须通过 `SESSION_ID_VECTORS`。A 的工作台在你们到之前用 `apps/workspace/src/stubs/{merge,render,session}.ts`（lane-a 上 14 个用例全绿），可以整份拿去当起点。 | 待 C |
| A03 | A → C | `packages/memory-repo` 实现 `MemoryRepoApi.openMemoryRepo` → `MemoryRepo`（`appendContribution`、`revokeContribution`、`regenerateCard`、`writeNote/readNote/deleteNote`、`appendReceipt`、`resetToSeed`、`listContributions`）。比人列的多两个：`revokeContribution`（`POST /personal/contributions/:id/revoke` 要用）和 `listContributions`（重建/导出）。工作台所有读都走 SQLite，记忆库是存储与溯源层，写入串行、author = 写入者、trailer `Agent-Cookie-Sig`。 | 待 C |
| A04 | A → D | `packages/ucp` 实现 `UcpModule.createUcp(opts)` → `UcpApi`（`searchOffers`、`createCart`、`createCheckout`、`setDestination`、`complete`，每步返回 `{ status, continueUrl?, orderId?, messages }`）。status 与 messages.severity 取自 ucp CLI 0.9.1 的取值；`createCheckout` 用 `--input '{"cart_id":…,"line_items":[]}'`；失败抛 `UpstreamError`（带 continueUrl）。USD/ships_to US/available/尺码的筛选由工作台做，ucp 包只归一化不过滤。 | 待 D |
| A05 | A → C | 工作台读 fixtures 的约定见 `packages/contract/src/fixtures.ts`：`users.json`（SeedUser[]，含 secret）、`agents.json`（Agent[]，不含钥匙）、`contributions.json`、`dev-keys.json`（`{ "<key>": { agentId, role } }`，只在 DEMO/TEST 模式加载）、`memory/`（记忆库初始 commit）、`ucp/`（录好的 ucp 响应）。origin/lane-c 上还看不到 C 的 seed（8606f9e 不在远端）；推上来后如果形状不同，告诉 A，A 改读取方，不改你们的文件。 | 待 C 推送 |
| A06 | A → B | 回复 B08–B10：契约已冻结，见 A01。根 `pnpm-workspace.yaml` 含 `packages/*`、`apps/*`，根 `pnpm-lock.yaml` 由 A 生成；B 合入时把 `link:../sdk` 改为 `workspace:*`、删掉各包自己的锁文件，`pnpm -r build` 按依赖拓扑自动 contract → sdk → cli/mcp。真实工作台 H6 在 127.0.0.1:4310 上线，响应形状以 `@agent-cookie/contract` 为准。 | 待 B 合入 |
| A07 | A → D | 回复 D 的请求：`PaymentAuthorization`、`SignHandshake`、`AuthorizePayment`、`Receipt.amount`、`AUTHORIZATION_USED`/`OVER_BUDGET`/`UPSTREAM_ERROR` 都已在契约里（金额统一美分）。`GET /.well-known/agent-cookie-jwks.json?sessionId=` 已按 pairwise 改了端点说明；`POST /personal/unlock` → `handleUnlock` 和两个环境变量 `AGENT_COOKIE_JAR_KEK`、`AGENT_COOKIE_UNLOCK_SECRET` 由 A 在工作台 T1 里接，D 的包合入 main 后生效。请 `packages/auth`、`packages/pay` 的 `contract.ts` 改为从 `@agent-cookie/contract` 导入。 | 进行中 |
| A08 | A → 人 | 请把 CLAUDE.md / AGENTS.md 的目录表改成新分工（A：`packages/contract` `apps/workspace`；B 加 `apps/workspace-fake`；C 加 `packages/rules` `packages/memory-repo`；D 加 `packages/ucp`），并把 plan 里的 `packages/core` 改成 `packages/contract`。A 不改这两个文件。`docs/requests.md` 在 lane-a/b/d 上都是新增文件，合并时 add/add 冲突：保留全部行（lane-a 的版本已含 lane-b 原文，D 的五行另附在下面）。 | 待人 |

D 线 `lane-d:docs/requests.md` 原文（附录，便于合并）：
- [D→A] Add `PaymentAuthorization`, `SignHandshake`, and `AuthorizePayment` to core, and add `Receipt.amount`.
- [D→A] Add error codes `AUTHORIZATION_USED` 403, `OVER_BUDGET` 403, and `UPSTREAM_ERROR` 502.
- [D→A] Mount `POST /personal/unlock` and call `@agent-cookie/auth` `handleUnlock`.
- [D→A] Mount `GET /.well-known/agent-cookie-jwks.json?sessionId=` and return `jar.jwks(sessionId)`; the key is pairwise per session, not one jar key.
- [D→A] Add environment variables `AGENT_COOKIE_JAR_KEK` and `AGENT_COOKIE_UNLOCK_SECRET`.

2026-10-17，B 线接线更新（基于 A `72206dd`，已合入 lane-b，未合入 main）：

| ID | 发起 → 接收 | 请求与依据 | 状态 |
| --- | --- | --- | --- |
| B12 | B → A/C | 用户已将 `apps/workspace-fake` 分配给 B。已实现 loopback 4310 的个人卡、handshake、fields（contract canRead + selected quote）、intent/quotes/accept、receipts/grants/revoke/activity/reset；现在是内存 Sample 后台，无 UCP 外呼、无真实订单。复用 A `stubRules`，等 C rules 发布再替换。 | 本地 HTTP 与 SDK 链路已测 |
| B13 | B → C | 多次自行 fetch 并检查全部远端；截至 13:22 PDT，lane-c 仍 `7da6659`，未发现 fixtures/。loader 已对齐 contract `DevKeys` map 与单用户 seed，临时 B fallback 只写 gitignored `.runtime/sample-fixtures`，未改 C 目录。fake 额外使用 `quotes.json`（Omit<Quote,id/intentId>[]）；请推送 seed 和 UCP recorded responses 后告知文件格式，B 做适配。 | 等实际 fixture 文件，当前不宣称 C seed 兼容已验收 |
| B14 | B → A | 已改为 `@agent-cookie/contract` 与 workspace:*，移除 B 包独立锁文件，根 lockfile 由 pnpm 安装产生更新。SDK 扩展 createIntent/getQuotes/find/accept/getReceipts；MCP 为 get_my_card/find_agents/accept_quote/list_receipts。formal backend 仍需核对 HTTP envelopes（intentId、{quotes}、AcceptResult、{receipts}）。 | Sample stdio 与 HTTP 已联调 |
| B15 | B → A/C | Photon 项目及 shared iMessage 线路已建，先前 ping 已 delivered 且用户确认收到；本轮持续 Socket.IO 已连接，绑定唯一测试 sender，游标/发件箱 0600 持久化，重复消息幂等，未知发送结果停机。个人 agent 为受限确定性 parser，无 LLM key 依赖。业务会保留 Sample、未知 ETA 与 handoff 警告。 | 手机购物步骤等待用户发送；不计作 A17 已通过 |

| B16 | B → A/C | B15 更新：用户已完成手机找鞋/选第二双，两个外发消息从 Photon 分别读回 `delivered`；用户明确确认收到，checkout receipt 只有 Sample merchant B 的 shipping_address。脱敏证据在 `docs/evidence/2026-10-17-imessage-sample.json`。这是真实 iMessage + Sample backend，不是真实 UCP/订单。Desktop 已安装及配置，停在登录页，等用户登录后补 A10 UI 证据。 | 手机 Sample 主链路通过；正式集成与 A10 待完成 |

| B17 | B → A/C | B16 更新：用户登录后，Claude Desktop 2.42304.0 实际通过本地 MCP 调用 get_my_card 与 find_agents；显示 Sample 卡（zh/42/120）及 99/115 USD 报价，ETA 均未知，未调用 accept_quote。已保存原生 Desktop 卡片截图、两次 MCP 请求/返回及同时间段后台 card/intent/quotes 活动记录，见 docs/evidence/2026-10-17-claude-desktop.json 和 claude-card.jpg。SDK 增加 owner-only getActivity（不注册为 personal MCP 工具），29 项 SDK 测试及构建通过，真实个人 key 读 activity 被 403 拒绝。 | A10 的 Sample 客户端链路有证据；正式 A/C 集成及全套 P0 仍待验收 |
