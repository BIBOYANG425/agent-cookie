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
