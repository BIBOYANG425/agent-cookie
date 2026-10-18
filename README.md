# Agent Cookie

让陌生 agent 在第一条消息之前认识你，并且只拿到当前任务允许的上下文。

## 它做什么

| 对象 | 行为 |
| --- | --- |
| 身份卡 | agent 写贡献，确定性规则合并为字段与来源。用户陈述可立即生效；学习到的偏好按独立对话或意图核对支持，过时信息会衰减。 |
| 对话 cookie | 为每家商家派生独立 session ID，配上握手和只属于该商家的 note。同一用户换个人 agent，同店 ID 保持一致。 |
| 工作台 | 注册与匹配 agent；逐次核对字段策略、用途、有效期与撤销；记录回执。模型不能替自己批准权限。 |

控制台每两秒读取身份卡、学到的偏好、本次请求条件、授权、回执和活动。模型来源可见，学习可暂停，贡献和授权可撤销。已传给商家的内容无法靠撤销收回。当前实时卡片接口只有来源 agent ID；逐贡献撤销在“学到的”条目上有真实 contribution ID 时可用。

基线：main `35e8b56` 加 C22/C23。工作台/控制台的环境由启动 shell 提供；Photon/MCP 脚本会读取各自本机 `.env`。学习真实模型六场景通过；**完整手机学习与报价排序证据仍待补**。A15 已退出演示，A16（Claude Code + Devin）和 A23 按 2026-10-17 收口通过。具体范围见[证据索引](docs/evidence/README.md)。

## 架构

下面按 [plan 第 1 节](docs/plan.md)原样保留设计图。图中的 ACME 是历史设计：A15 因 Tier 0 协议不匹配已砍，不在当前 demo。控制台的 owner API 由服务端 SDK 桥调用；商家 MCP HTTP 4311 仍是计划项。UCP 商家不接收我们的 session ID，工作台内部的商家代理持有它。

``` mermaid

flowchart LR
  U["用户<br/>iMessage"] -->|一句话| P["个人 agent<br/>Photon 线 + SDK"]
  D["Claude Desktop<br/>+ 挂钩"] -->|MCP| W
  P -->|SDK| W["工作台<br/>Hono + git 记忆库 + SQLite<br/>127.0.0.1:4310"]
  W -->|ucp CLI：目录 / cart / checkout| S1["Shopify 店 A<br/>UCP 端点"]
  W -->|ucp CLI| S2["Shopify 店 B<br/>UCP 端点"]
  W -->|文本前缀 / skill 接入| ACME["ACME 鞋店<br/>Anthropic blueprint 原版"]
  C[控制台] -->|owner API| W
```

## 五分钟跑起来

本地 **Sample / Fixture replay** 不需要 Photon 或模型账号。真实 iMessage、Desktop 和实时商家请求另需各自配置。使用 Node **22.12+ 的 22.x**（本次验证 22.23.3）、Git、根目录声明的 pnpm 9.12。所有命令从仓库根运行；当前没有根 `pnpm dev` 脚本。

```sh
pnpm install --frozen-lockfile
pnpm build:deps

# 终端 1：真实工作台，使用 Sample seed 与录制的 UCP 响应
AGENT_COOKIE_DEMO=1 AGENT_COOKIE_UCP=fixture pnpm workspace
# 127.0.0.1:4310
```

公开演示钥匙在 [fixtures/dev-keys.json](fixtures/dev-keys.json)，仅 demo/test 模式加载。控制台用 `role=owner`；Photon 用 `sample-personal-photon`，Desktop 用 `sample-personal-desktop`，不要互换。非演示模式首次生成的 owner key 在数据目录的 `owner.key`（0600）。不要把真实 key 写进仓库或 `VITE_*`。

```sh
# 终端 2：只把公开 Sample owner key 放入本机进程环境，不打印
export AGENT_COOKIE_KEY="$(node -e 'const f=require("node:fs");const d=JSON.parse(f.readFileSync("fixtures/dev-keys.json","utf8"));const r=Object.entries(d).find(([,v])=>v.role==="owner");if(!r)process.exit(1);process.stdout.write(r[0])')"
AGENT_COOKIE_SAMPLE=1 AGENT_COOKIE_SDK_ROOT="$PWD/packages/mcp" pnpm --dir apps/console dev
# 127.0.0.1:5173 → 连接本机工作台 → 连接
```

页面默认打开本地 Sample 预览；连接后才读取真实 4310。`AGENT_COOKIE_SDK_ROOT` 是当前依赖布局的桥接路径，须含 `node_modules/@agent-cookie/sdk/dist/index.js`。owner key 始终留在控制台服务端。缺少 SDK 方法时，仅已核对的 HTTP 路径有 `TODO(sdk)` 过渡；本次请求历史目前使用这一过渡。

```sh
# 实时 UCP 的独立 CLI；fixture 模式不需要联网安装全局 CLI
npm i -g @shopify/ucp-cli@0.9.1
OPT_OUT_INSTRUMENTATION=true ucp profile init --name agent
```

`AGENT_COOKIE_UCP=live` 才查询当时的商家目录；实际店数最多两家，可能只有一家或没有匹配。价格和库存随时间改变，未知 ETA 或尺码不匹配会明确说明。Fixture replay 是真实响应的历史副本，可能不对应新的商品需求；不能将固定鞋款改名冒充外套。Sample 地址不会发给实时商家。[UCP 采集来源](fixtures/ucp/README.md)

### Photon iMessage 与 Claude Desktop

```sh
# 终端 3：首次复制模板，已有 .env 不覆盖；在本机填写 Photon 项目和 personal key
cp -n apps/channel-photon/env.example apps/channel-photon/.env
pnpm --dir apps/channel-photon check
pnpm --dir apps/channel-photon start

# Desktop：构建 stdio 服务，按 MCP README 配置本机绝对路径
pnpm --filter @agent-cookie/mcp build
cp -n packages/mcp/env.example packages/mcp/.env
pnpm --dir packages/mcp check
```

Photon 需要已分配的 Beta iMessage 线路、项目凭据和双方 handle。[Photon 设置](apps/channel-photon/README.md)说明如何配置；`check` 只检查配置，不代表手机接通。同一线路只运行一个监听。购物文本路由是确定性解析，不声称能理解任意自然语言；模型用于偏好分类和提取。

[Claude Desktop MCP 配置](packages/mcp/README.md#claude-desktop)使用独立 personal key，暴露 `get_my_card`、`find_agents`、`accept_quote`、`list_receipts`。保留 Desktop 原有其他 servers。真实 Desktop 证据见 [A10](docs/evidence/A10-real-client.md)。

启用学习要在**工作台**本机环境显式设置 `AGENT_COOKIE_LEARN_PROVIDER=openrouter` 与 `OPENROUTER_API_KEY`，在 **Photon** 设置 `AGENT_COOKIE_LEARNING_BINDING=workspace-v1`。仅有 key 不会自动启用。流程为本地过滤 → `typesafe/jev-1.14` gate → `openai/gpt-oss-120b` 提取 → 确定性校验和合并。安静五分钟后待下一次 Dreaming 调度；演示可显式设 `DREAMING_INTERVAL_MS=30000`，不是精确五分钟响应承诺。[真实模型验证](docs/evidence/2026-10-17-gate-redesign.md)

### 用 SDK 接入：助理公司、商家、自己的 agent

`@agent-cookie/sdk` 是唯一的集成面（`packages/sdk/README.md` 有三段各不超过 25 行的快速开始）：助理公司用 `AssistantClient`（注册 → 申请 link → 用户在控制台/CLI 一键批准 → `context()` 得到策略允许的值 → `find`/`accept` → `remember` 带用户原话的证据）；商家用 `MerchantClient`（握手只有字段名，结账时按用途读地址，`payment_method` 永远被拒）；用户自己的 agent 用 `WorkspaceClient`。包可在仓库外安装（`pnpm --filter @agent-cookie/sdk pack:smoke` 离线验证），https 任意主机、http 仅回环，工作台而非 SDK 决定每一次放行。

```sh
pnpm --filter @agent-cookie/sdk build
AGENT_COOKIE_URL=http://127.0.0.1:4310 AGENT_COOKIE_OWNER_KEY=ck_owner_sample node examples/assistant-sdk/main.mjs
AGENT_COOKIE_URL=http://127.0.0.1:4310 AGENT_COOKIE_PERSONAL_KEY=ck_personal_sample node examples/merchant-sdk/main.mjs
cd tests/acceptance && node node_modules/vitest/vitest.mjs run --config vitest.config.mjs a32-churn.test.ts
```

两个示例和 A32（两家助理公司之间的 churn：第二家助理第一次读 context 就知道第一家学到的）都对演示模式的真实工作台跑，输出只有计数、id 和字段名；数据为 Sample，UCP 报价为录制回放。设计见 `docs/bring-your-own-agent-plan.md`。

### 环境变量与端口

| 变量 | 默认 / 使用者 |
| --- | --- |
| `AGENT_COOKIE_URL` | SDK/CLI/MCP/Photon 默认 `http://127.0.0.1:4310`；也用于握手 jar 地址。控制台上游固定 4310。 |
| `AGENT_COOKIE_KEY` | 当前调用者凭据；控制台 owner，其余按角色。无通用跨角色钥匙。 |
| `AGENT_COOKIE_DEMO` | `1` 开放 owner reset、加载公开 Sample keys；默认关闭。 |
| `AGENT_COOKIE_TEST` | 仅测试 `1` 开放 `/test/clock`，不用于录屏伪造时间。 |
| `AGENT_COOKIE_UCP` | 默认 `fixture`；`live` 为实时商家调用。 |
| `AGENT_COOKIE_UCP_FIXTURES` | 默认 `<FIXTURES_DIR>/ucp`，替代录制目录。 |
| `AGENT_COOKIE_DATA_DIR` | 默认 `apps/workspace/data`。 |
| `AGENT_COOKIE_SAMPLE` | `1` 保留通道/SDK/控制台 Sample 标签；不改变权限。 |
| `AGENT_COOKIE_SDK_ROOT` | 控制台 SDK 运行根；上面的命令使用 `packages/mcp`。 |
| `AGENT_COOKIE_CHANNEL_STATE` | Photon 运行状态路径；默认本包 `.runtime/channel-state.json`。 |
| `AGENT_COOKIE_LEARN_PROVIDER` | 工作台 `off`（默认）或 `openrouter`。 |
| `AGENT_COOKIE_LEARN_MODEL` | 提取器默认 `openai/gpt-oss-120b`；只接受 learn 包白名单中的备选，Jev gate 固定。 |
| `AGENT_COOKIE_LEARN_MODE` | 工作台默认 `all`；`explicit-only` 为受限提取模式。 |
| `AGENT_COOKIE_LEARNING_BINDING` | Photon/MCP 显式 `workspace-v1`，默认不采集。 |
| `AGENT_COOKIE_LEARNING_CONVERSATION_ID` | MCP 宿主提供的稳定来源 ID；进程重启不能制造新来源。 |
| `AGENT_COOKIE_LEARNING_OTLP_ENDPOINT` / `AGENT_COOKIE_LEARNING_OTLP_TOKEN` | 可选学习遥测出口；不设置则不导出，不记录对话原文。TOKEN 当前仅旧 Spectrum 入口读取，Beta/后台未接。 |
| `AGENT_COOKIE_JAR_KEK` / `AGENT_COOKIE_UNLOCK_SECRET` | P1 jar hooks，必须成对配置；KEK 为32字节 base64url。不是主线先决条件。 |
| `AGENT_COOKIE_JAR_PATH` | 可选 jar 保存路径。 |
| `PORT` | 工作台 4310，固定绑定 127.0.0.1；控制台 5173。 |
| `MEMORY_REPO_PATH` | 默认数据目录下 `memory`；工作台初始化的用户 Git 记忆库。 |
| `SQLITE_PATH` / `FIXTURES_DIR` | 默认数据目录下 `workspace.sqlite` / 仓库 `fixtures`；客户端不直读 SQLite。 |
| `UCP_BIN` / `OPT_OUT_INSTRUMENTATION` | 可选覆盖 pinned CLI；UCP 使用 `true` 退出统计。 |
| `DREAMING_INTERVAL_MS` / `LEARN_TIMEOUT_MS` | 默认 `300000` / `30000`；前者设 `0` 停调度，后者为模型任务超时。 |
| `PHOTON_PLATFORM` | `imessage`。 |
| `PHOTON_PROJECT_ID` / `PHOTON_API_KEY` | 本机 Photon Beta 项目与 key。 |
| `PHOTON_TEST_SENDER` / `PHOTON_AGENT_HANDLE` | 明确允许的本人测试号码和 agent handle。 |
| `OPENROUTER_API_KEY` | 工作台本地加载；不交给 Photon 或浏览器。 |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` / `SENTRY_TRACES_SAMPLE_RATE` | 可选 tracing/logs，未设置 DSN 时关闭；外部 Dashboard 证据待补。 |
| `AGENT_COOKIE_PAY` | 工作台支付阶段：`off`（默认）/ `fake` / `visa`。`fake` 为 `@agent-cookie/pay` 的假 provider（演示用，如实标注）；`visa` 为 Visa Acceptance 沙盒 provider，只允许沙盒主机。Stripe 代码在 `packages/pay` 但未接线。 |
| `VISA_ACCEPTANCE_MERCHANT_ID` / `VISA_ACCEPTANCE_KEY_ID` / `VISA_ACCEPTANCE_SHARED_SECRET` | `AGENT_COOKIE_PAY=visa` 必需；只从环境读取，不记录、不打印。截至 2026-10-18 Visa 未提供沙盒，provider 只对照官方 Node SDK 离线校验，仓库内没有任何真实调用结果。 |
| `AGENT_COOKIE_EXPERIMENT` | `off`（默认）或 `ranking`：按 intent 分组的排序对照实验，报表见 `GET /owner/experiments`。 |

高级工作台限时/重试配置见 [config.ts](apps/workspace/src/config.ts)。商家 MCP HTTP 4311 是计划项；unlock 4312 独立验证；blueprint 8000/3000 仅保留 A16 接入材料，不是当前主线服务。

演示重置使用 owner 环境中的 `pnpm demo:reset`（`POST /demo/reset`），且工作台必须开启 demo。它清理 SQLite 演示状态，**只把 Git 的 `contributions/`、`notes/`、`CARD.md`、`receipts.md`、`POLICY.yaml` 恢复到 seed**；skill 的其他文件及 `MEMORY.md` 改动保留。不要对正在聊天或录制的实例重置。稳定商家 session ID 不变。

## 演示流程

1. iMessage 随口说一个需求，按本次预算、适用尺码与卡上的偏好搜索，展示实际返回的至多两家报价；没有匹配就直说。**真实通道已留日志，新的多品类实时完整原片仍是计划。**
2. 说“要第二双”（仅实际有第二双鞋时；其他商品用“选2”），返回该商家的付款/继续处理链接。展示 checkout 用途回执，地址只放给被 accept 的一家。handoff 不表示已付款或下单。[真实收发材料](docs/evidence/2026-10-17-real-adapters-verification.md)
3. 换 Claude Desktop，读取同一个人的卡、向同店重新查询；展示 pairwise session 连续性。当前没有商家模型读 note 后主动问候的证据。[同店验证](docs/evidence/2026-10-17-postmerge-b-verification.md)
4. 控制台展开来源、用途和剩余时间，撤销授权。可选展示“商家申请 5 项、可给 4 项”：**UI Sample 已完成；A-Needs 投影和 SDK 透传未到时跳过这一拍**。[控制台截图](docs/evidence/console/README.md)
5. 对话中随口说一句偏好，安静五分钟后观察“学到的”，显示候选/已上卡、证据来源、模型链，必要时撤销。**计划补拍**：真实模型六场景通过；手机修复后干净正向学习与相同候选集的报价排序仍缺证据，C20 不算完成。[手机材料与限制](docs/evidence/2026-10-17-phone-learning-live.md)

## 验收

状态是证据范围，不是宣传承诺。P0 = A01–A12、A17、A18、A22；已有自动测试通过不等于手动原片和 A18 失败录制全部完成。详细文件与日期都在[证据索引](docs/evidence/README.md)。

| 编号 | 状态 |
| --- | --- |
| A01 注册 agent | 通过（自动 HTTP） |
| A02 合并规则 | 通过（普通字段按 writer；pref 按独立证据） |
| A03 session ID 隔离 | 通过（自动 HTTP；算法向量另见 rules） |
| A04 握手只有字段名 | 通过（auto 风格值与字段名按契约） |
| A05 按用途读字段 | 通过（地址仅选中商家 checkout） |
| A06 过期 | 通过（POST /test/clock） |
| A07 撤销 | 通过（后续读取拒绝，不承诺收回已传内容） |
| A08 note 隔离 | 通过（自动 HTTP） |
| A09 意图匹配 | 通过（录制 UCP fixture；不等于实时库存） |
| A10 真实客户端 | 通过（手动 Claude Desktop / MCP，录制基线） |
| A11 注入 | 通过（商家输入不能扩权） |
| A12 重置复演 | 通过（隔离 fixture；只重置四个受管路径） |
| A13 并发与幂等 | 通过（自动 HTTP） |
| A14 控制台 | 手动证据（Sample 来源撤销、SDK 实连；当前截图见 console/） |
| A15 零接入投递 | 已砍（Tier 0 协议不匹配，2026-10-17 决定） |
| A16 skill 生成的接入 | 通过（Claude Code + Devin；按 2026-10-17 人的收口裁决） |
| A17 iMessage 主流程 | 手动证据（搜索→选择→handoff 日志；连续原片待补） |
| A18 UCP 失败路径 | 阻塞（handoff 已验；真实售罄和 escalation 两种录制仍 todo） |
| A19 passkey 解锁 jar | 阻塞（库级实现与测试已有；缺真实手机 passkey 证据） |
| A20 商家验签登录 | 手动证据（库级成对钥匙/验签；真实商家登录闭环未声明通过） |
| A21 支付单次限额 | 手动证据（授权边界测试；不代表真实支付） |
| A22 回头客 | 通过（同店 session 连续性；未声称商家模型记忆开场） |
| A23 stock skill 互操作 | 通过 |

复跑命令（本文不把命令列表当作本轮运行成绩）：

```sh
pnpm test
pnpm typecheck
pnpm --dir apps/console build
node fixtures/verify.mjs
node fixtures/ucp/verify.mjs
```

C 不重写 A 的 P0 自动验收；[tests/acceptance](tests/acceptance)保留性质检查及 A23 支撑。C23 本轮已运行控制台 57 tests、类型检查与构建。C11 的完整 note 生命周期接口仍 **P1 BLOCKED**；C20 等干净的实机学习/排序证据。

## 与 Cognition Agent Memory Repo 的关系

我们兼容它的文本格式：短 `MEMORY.md`、`## Index`、根相对 `[[链接]]`、一行一条和开放 `[key: value; key: value]` 元数据。原版 stock `agent-memory-repo` skill 能打开记忆库；A23 实际保存/提交偏好，新会话读回，同时工作台 contribute、purpose 读取、回执和限定 reset 均成功。[A23 证据](docs/evidence/cognition-skill-interop.md)

工作台托管四条路径，用户 agent 通过 CLI/HTTP 写入，`CARD.md` 由规则生成。其余目录可按 Agent Memory Repo 方式自由记事。我们的扩展是字段策略、贡献合并、来源 ID、按商家隔离的 cookie、签名 trailer、用途回执和 scoped reset；不将它们说成 Cognition 规范要求。商家没有 Git 凭据，只有被授权的 API 视图。撤销/forget 改当前投影，旧 Git 历史仍保留。

## 不做什么

- 不存卡号；`payment_method` 只允许支付提供方 token 引用。
- 不持久保存学习对话的整段原文；原始 observation 只在有界内存队列，持久证据为结构化贡献和最多200字摘句。启用 OpenRouter 后，过滤后的文本会交给配置的模型处理。
- 不做跨站第三方 cookie，也不向不同商家发送同一个全局用户标识。
- 不代替用户完成付款；主线交付商家 handoff 链接。支付限额库/测试模式不是已完成的真实支付服务。

## 赛道与提交材料

| 赛道 | 本项目材料与当前范围 |
| --- | --- |
| Applied Intelligence | Jev gate + gpt-oss 提取，规则决定晋升与权限；真实模型6/6，实机正向学习/排序补拍中。 |
| Photon | Beta iMessage 真实收发、选择与handoff；连续原片待补。 |
| Visa | TAP 互通及成对签名验证；不宣称真实支付清算或商家登录闭环。 |
| Cognition | A23 stock skill 格式互操作；A16 Claude Code + Devin 接入实跑。 |
| Paper | 控制台的来源、授权、撤销与通用字段界面；当前截图为明确标注的 Sample。 |
| Sentry | tracing/logs 的离线验证；外部账号 Dashboard 取证仍计划中。 |

[Devpost 草稿](docs/devpost.md) · [视频分镜](docs/video-storyboard.md) · [素材清单](docs/evidence/recording-manifest.md) · [证据索引](docs/evidence/README.md) · [跨线请求](docs/requests.md)。这些是准备提交的赛道，不是获奖或资格声明。

第三方资产：Anthropic commerce-agents 原版保留在仓库外供 A16 接入；Shopify UCP 响应按采集时间标注；Agent Memory Repo stock skill 未修改。Sample 身份/地址/钥匙、Fixture replay、Recorded run 与现场实时响应必须区别标明。
