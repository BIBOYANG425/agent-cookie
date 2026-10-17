<!-- 导出自共享 Artifact「Agent Cookie 工程计划」。以 Artifact 为准；此副本供离线阅读与 coding agent 使用。v0.3 的修订在本文件里做，需回写 Artifact（见第 7 节）。 -->

LA HACKS 2026 · 工程计划 v0.3 · 2026-10-17

# Agent Cookie 工程计划

一个让陌生 agent 在第一条消息之前就认识用户的基础设施。两个人加四个 coding agent（一个 Claude Code、两个 Codex、一个 Devin），24 小时，做出一个能从头到尾演示的版本。

本计划以这几天的讨论为基准。技术栈采用队友方案里的选择（TypeScript、Node、SQLite、MCP）。开发按四条并行线分给四个 coding agent，见第 4 节。D 线（Devin）负责 passkey 登录与支付凭据，P1，不影响主线。10 月 17 日版：不报 Fetch 赛道，Photon 为主舞台，商家是 UCP 上的真实 Shopify 店。

**北极星：每一次 agent 对 agent 的第一句话，都带着一张 Agent Cookie。**这个周末证明它能用；第 8 节写它要变成什么：agent 经济里由用户持有的身份与同意层，一个谁都能实现的开放协议。

> **v0.3 改了什么（相对 v0.2）**
> - 修内部矛盾：命题是六个不是五个；第 4 节改成四个 coding agent、四条线；T2 的 SDK/CLI 与目录归属冲突（改为 `packages/sdk`、`packages/cli` 归 B 线）；回调载荷统一为 `type` 字段；去掉与"用户不点头"冲突的 `pendingRequests`。
> - 修 demo 真实性：Shopify 店不会收到我们的 session ID，新增"UCP 商家：工作台代理"一节并改台词；2:05 一拍原来让 Claude Desktop 读商家的 note，违反 A08，改为由商家代理读自己的 note 开口。
> - 修 Tier 0 矛盾：只给字段名的握手前缀无法让 ACME 报出 42 码（A15），明确 Tier 0 前缀可带 auto 字段值。
> - 契约补洞：`Agent.chatEndpoint` / `domain`、Quote 的 checkout 字段、`GET /personal/grants`、`POST /personal/contributions`、D 线预留端点、测试时钟、D 线与上游错误码；去掉已砍掉的 pharmacy / hotel；session ID 按稳定的 merchantKey 推导。
> - 验收：明确 P0 集合（不再写"A01–A18 全绿"，其中有 P1）；补命题 6 的验收 A22；命题 → 验收对照；A10、A17 标为手动证据；A09 用录好的 UCP 响应保证可重复。
> - 新增：开赛前预检、环境变量与端口表、HTTPS/手机访问风险、开放问题（第 7 节）。
> - 新增：第 8 节"更大的图景"——北极星、开放协议、四阶段路线、网络效应、购物以外的场景、商业模式假设、规模化风险、答辩里怎么讲大。24 小时范围不变。

## 1 · 这个计划具体是什么

我们做三样东西，加上演示用的 agent。

### 挂钩（packages/mcp）

一个 MCP server。任何 agent 装上它就连上工作台。按钥匙的角色给出不同的工具：个人 agent 用来找 agent、写记录、看回执和撤销；商家 agent 用来拿握手、按用途读字段、写贡献记录、写自己的 cookie。

### 工作台（apps/workspace）

一个本机 HTTP 服务加 SQLite。它做五件事：agent 注册、贡献记录合并成身份卡、按意图匹配 agent、发放和检查授权、记录活动。所有权限判断在这里，不在模型里。

### 控制台（apps/console）

一个很小的网页。三个视图：身份卡（每个字段的来源）、授权（剩余时间、撤销）、活动日志。还有一个"重置演示"按钮。

### 演示 agent（examples/）

个人 agent 住在 **iMessage**（Photon 线 + 我们的 SDK）；第二个个人 agent 是装了挂钩的 Claude Desktop。商家是 **UCP 上的真实 Shopify 店**（Shopify 全球目录，"trail running shoes" 380 个真实结果，真实 cart / checkout），它们不认识我们也不需要认识。另有一拍：`anthropics/commerce-agents` 的 ACME 原版，演示有自己 agent 的商家怎么零接入、再由 coding agent 一条命令深度接入。不做药店，不用 Agentverse，不用 Browser Use。

### 架构

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

### 三个核心对象

| 对象 | 是什么 | 谁写 | 谁读 | 怎么消失 |
|----|----|----|----|----|
| 身份卡 | 一个用户的一组标准字段，由贡献记录合并得出 | agent 写贡献记录，后台合并 | 每个 agent 只读策略允许的字段 | 字段长期没有新记录支持就掉卡 |
| 对话 cookie | session ID + 握手 + 这个 agent 自己的 note | 工作台生成 ID 和握手；agent 写 note | 只有这个 agent | note 带过期时间 |
| 授权（grant） | 某个 agent 在某段时间内能读哪几个字段 | 工作台在介绍时发放；按用途（purpose）自动扩大 | 工作台每次读取都检查 | 默认 10 分钟过期；用户可撤销 |

### 技术栈与约束

- TypeScript 全栈，pnpm workspaces 单仓库，Node 22，依赖锁版本。
- HTTP 服务用 Hono；MCP 用 `@modelcontextprotocol/sdk`（个人 agent 走 stdio，商家 agent 走 streamable HTTP）；CLI 用 Commander。
- **存储分两层。**长期数据（贡献记录、身份卡、note、回执、策略）存在用户的 git 记忆库里，格式 fork 自 Cognition 的 Agent Memory Repo，工作台用 simple-git 写入。短期热状态（sessions、grants、intents、quotes）存 better-sqlite3，不进 git。
- **git 是存储和溯源层，不是传输层。**只有用户自己的 agent 可以 clone 这个仓库。商家 agent 永远不碰 git，只通过挂钩调 API，由工作台代为提交。
- 自建商家 agent 的模型用 `claude-sonnet-5-5`；需要更快时换 `claude-haiku-4-5-20251001`。借来的 blueprint 用它自己的配置。
- Python 3.11 只用于 blueprint；商家侧 Python 调用直接用 httpx 打工作台 HTTP，不另写 Python SDK。
- 工作台只监听 127.0.0.1。每个 agent 一把钥匙，放环境变量。模型传来的 userId、agentId、purpose 只是参数，不是授权依据。
- 字段判断、授权、过期、合并全部用确定性代码。模型只做两件事：把商家的文本归到标准字段、生成对话回复。
- 页面和日志不展示编造的指标。示例数据统一标 Sample。

### 仓库结构

    agent-cookie/
      packages/core/        类型、字段策略表、合并规则、session ID 推导、授权检查（纯函数，无 IO）
      packages/sdk/         工作台 HTTP 客户端（CLI、挂钩、商家 agent 共用）
      packages/cli/         agent-cookie 命令行：SDK 加一层 shell
      packages/mcp/         MCP server，按角色暴露工具（薄封装 SDK）
      skills/agent-cookie/  SKILL.md：教个人 agent 何时调 CLI（npx skills add / devin plugins install）
      apps/workspace/       Hono 服务 + git 写入 + SQLite 热状态 + Dreaming 合并任务
      apps/console/         Vite + React，三个视图 + 重置
      apps/channel-photon/  Photon 2.0 线：收 iMessage，调 SDK，回鞋和付款链接
      examples/blueprint/   克隆 anthropics/commerce-agents 的脚本与启动配置（不入库其代码）
      skills/add-agent-cookie/  给 coding agent 的接入手册（Tier 2）
      fixtures/expected/    Tier 2 参考实现，只用于验收
      fixtures/             注册表、贡献记录、用户种子数据（Sample）
      tests/acceptance/     A01–A22（vitest，直接打工作台 HTTP；A10、A17 是手动证据，存 docs/evidence/）

### 用户记忆库的布局（fork 自 Agent Memory Repo）

MEMORY.md 以上是 Cognition 的格式原样保留，Devin 和它的 skill 照常工作。以下是我们加的：三个文件夹、一个策略文件、一条规则（CARD.md 是生成的）。

    memory-<user>/
      MEMORY.md            用户自己的 agent 整份加载（Cognition 约定，不改）
      CARD.md              生成物：合并后的身份卡，带来源、可信度、日期。禁止手改
      POLICY.yaml          各类别的字段策略（随握手 / 按用途 / 拒绝 / 可写）
      contributions/
        personal.md        每个 agent 只追加自己的文件，一行一条
        shoeA.md           [basis: observed; at: 2026-10-09; sig: 3ab8…]
      notes/
        k7f2.md            鞋店 A 的 cookie，文件名就是它的 pairwise ID，≤ 2 KB
        p93x.md            另一家店的 cookie
      receipts.md          只追加
      archive/             Dreaming 压缩后的旧记录

- **按写入者分区，所以没有冲突。**每个 agent 只追加自己的 `contributions/<agentId>.md`，谁也不改别人的文件。
- **CARD.md 只生成不编辑。**由 Dreaming（后台合并任务）按合并规则从 contributions 生成。事实冲突由规则解决，不由 git 的文本合并解决。
- **商家不碰 git。**它调 `contribute` / `write_note`，工作台核对 POLICY 后代为提交：commit author 写商家，商家对 payload 的签名放在 commit trailer。溯源免费得到，商家手里零 git 凭据。
- **读永远不走 git。**`get_fields` 由工作台读 CARD.md、核策略、返回值、追加 receipts.md。商家不能 pull 一份视图，只能问。

### 交付形态：一个 SDK，三个壳

skill 是模型照着做的说明，没有强制力；CLI 和 MCP 是代码，规则一定执行。给陌生人的只能是代码。

| 调用方 | 信任 | 形态 | 为什么 |
|----|----|----|----|
| 用户自己的 agent（Devin、Claude Code、Claude Desktop） | 完全，是它自己的仓库 | Skill + CLI（Claude Desktop 用 MCP stdio） | 它们本来就在 shell 和 git checkout 里。skill 说何时用，CLI 干活。安装方式和 Cognition 的一样 |
| 商家 agent（别的公司） | 无 | MCP（远程，streamable HTTP） | 唯一能强制范围的路径。每个 agent 一把钥匙，每次读都在服务端核对。永远不给 skill |
| 商家后端（没有模型） | 无 | SDK | Shopify app 调 `getFields`，不调聊天工具 |
| 测试、演示、运维 | \- | CLI | `agent-cookie reset`、`agent-cookie read --as shoeA --purpose checkout`；验收步骤都能写成 shell 行 |

**一条硬规则：**skill 只能包装 CLI，不能自己实现。skill 一旦教模型"直接编辑 CARD.md"，强制力就没了。个人 agent 可以通过 git 整份读自己的仓库，但每一次写仍走 `agent-cookie contribute`，合并规则和签名对自己也生效。

### 接入阶梯：商家不装我们的东西，我们怎么进去

真实场景里外部商家不会预装我们的类。我们能交付的只有三样：一段文本、一个 MCP server、一套教 coding agent 干活的 skill。Demo 演这三样本身。

| 级 | 商家要做什么 | 我们提供 | 商家得到 | demo 里谁 |
|----|----|----|----|----|
| 0 · 零接入 | 无 | 工作台把握手渲染成第一条消息的文本前缀 `[agent-cookie] session k7f2 · lang zh · tone 简短 · shoe_size 42 · budget 120 · on request: shipping_address(checkout)`，投递到它现有的聊天端点 | 第一句话就认识你；只读不写；它自己的 memory 仍在它那边 | ACME 鞋店（第 7 拍开头） |
| 1 · 只改配置 | MCP 配置加一行我们的 server，装我们的 skill | 远程 MCP 工具 + skill 教模型何时调 | 读写都有，按用途放行，note 存回工作台 | Claude Desktop（个人 agent 侧就是 Tier 1） |
| 2 · 改代码，由 coding agent 改 | 开发者在自己仓库跑 `/add-agent-cookie` | `skills/add-agent-cookie/SKILL.md`：找 session 标识 → 找 memory / preferences 读写点 → 用 SDK 包一层 → 保留原有写过滤 → 加测试 | 深度接入（blueprint 的 `MemoryStore` 级别） | ACME 鞋店（现场由 Devin 或 Claude Code 升级） |

**参考答案不是交付物。**`AgentCookieMemoryStore`（Python，约 80 行：`subject_id` = pairwise session ID；`get_facts` → `get_fields` + `read_note`；`upsert_facts` → 可写字段走 `contribute`、其余走 `write_note`；`clear` → 删自己的 note）保存在 `fixtures/expected/`，只用来验收 skill 现场生成的结果。Tier 1 对 blueprint 是否零代码未验证（它的 MCP connectors 在后端侧），demo 不赌它。设计文档：`docs/superpowers/specs/2026-10-12-demo-integration-ladder-design.md`（注意：`docs/superpowers/` 在 `.gitignore` 里，coding agent 的克隆里没有它；本节就是它的有效摘要）。

**Tier 0 前缀是唯一把值写进消息的地方。**零接入的商家没有工具可调，只给字段名它就报不出 42 码（A15）。所以前缀只带该类别策略表里的 auto 字段值（这些本来就允许随握手给），purpose 字段只列名字、永不带值；每次投递写一条回执。Tier 1 以上的握手仍然只有字段名，值走 `GET /agent/fields`。

### UCP 商家：工作台代理

Shopify 店不认识我们，UCP 也没有地方放我们的 session ID。所以在系统内部，每个 `seller.domain` 由工作台自动注册成一个 `shoe` 类的**代理 agent**（`agentId = ucp:<domain>`，`domain` 写进注册项，没有对外钥匙）。代理和任何商家 agent 走同一套 `canRead`、授权、回执、note；session ID 按 `domain` 推导，所以重置或换个人 agent 后仍是同一个回头客。Shopify 那边只收到 cart / checkout 载荷，地址只在 `checkout update` 那一步出现。台词据此说"工作台替每家店开了一个只对它有效的 ID"，不说"店家拿到了 ID"。


## 2 · 达成目标是什么

**目标一句话：**用户对自己的 agent 说一句话，两家从未接触过的鞋店 agent 直接报价，用户没有重复任何信息，地址只进被选中那一家的 checkout，10 分钟后一切授权失效。全程真实运行，可重置，可复演。

### 双边定位

这层基础设施有两个客户，缺一个都站不住。浏览器方案（agent 用用户自己的账号逛网站）只能给用户无感，给不了商家下面这些，这也是评委问"为什么不直接 browser-use"时的答案。

| 谁 | 得到什么 | demo 里哪一幕证明 |
|----|----|----|
| 用户 | 无感：不重复、不点头、随时能撤；每家店拿到的是只对它有效的假名 ID，拼不成一个人 | 一句话得到两双真鞋；地址只进被选中那家的 checkout；控制台撤销 |
| 商家 | 一条能认人、能追责的 agent 通道：第一条消息前就知道怎么服务；回头客认得出，哪怕用户换了个人 agent；每次读取有签名和回执，纠纷有账本；不用自建用户库（note 存在工作台） | 工作台终端：握手 → ucp 目录 → cart → 按用途放地址 → 写 note；ACME 一拍：零接入就认识你 |

### 必须成立的六个命题

1.  **先认识，后说话。**商家 agent 在收到用户任何消息之前就拿到握手。
2.  **每家一个 ID。**同一个用户在不同 agent 那里的 session ID 不同，且不可互推。
3.  **按用途给字段。**低敏感字段（auto）随握手可读：握手里只列字段名，值无需用途即可读（Tier 0 前缀例外，见接入阶梯）；敏感字段只在声明的用途与策略相符时给（例：shipping_address 只在 checkout）；策略外字段拒绝，且不泄露别的字段名。用户不需要点头，事后可查、可撤。
4.  **agent 写卡，规则合并。**两个 agent 说同一件事才上卡；猜的永远不上卡。
5.  **会过期，能撤销。**过期后和撤销后的读取立即被拒。
6.  **商家认得回头客，不认得人。**同一用户换了个人 agent，到同一商家仍是同一个 session ID；商家永远拿不到电话和全局标识。

命题 → 验收：1 → A04、A09、A15；2 → A03；3 → A05；4 → A02、A11；5 → A06、A07；6 → A22。

### 验收清单

全部 P0 通过才算"可演示"。**P0 集合 = A01–A12、A17、A18、A22；P1 = A13–A16、A19–A21。**本文和 AGENTS.md 里的"P0 全绿"都指这个集合。除 A10、A17（真实客户端，手动跑，证据存 `docs/evidence/`）外，每条都是 `tests/acceptance` 里的一个测试，直接调工作台 HTTP；需要外部服务的用 `AGENT_COOKIE_UCP=fixture` 读录好的响应。

| 编号 | 场景 | 通过标准 | 级别 |
|----|----|----|----|
| A01 | 注册 agent | 返回 agentId 和钥匙；钥匙能解析出角色和类别 | `P0` |
| A02 | 合并规则 | 两个不同 agent 的 observed/stated 一致 → 上卡；一个 → 候选；inferred → 永不 | `P0` |
| A03 | session ID 隔离 | 同一用户对两家店的 ID 不同；不能从一个算出另一个 | `P0` |
| A04 | 握手只有字段名 | 握手里有 lang/tone/length 三个风格值和 available 列表，此外没有任何字段值 | `P0` |
| A05 | 按用途读字段 | auto 字段直接返回；purpose 字段在用途相符时返回、不符时 403 PURPOSE_MISMATCH；策略外返回 403 SCOPE_DENIED，响应里不含其他字段名 | `P0` |
| A06 | 过期 | 用 `POST /test/clock` 把时钟拨到 expiresAt 之后，读取返回 403 GRANT_EXPIRED | `P0` |
| A07 | 撤销 | 撤销后下一次读取返回 403 GRANT_REVOKED；已传出的内容不承诺收回 | `P0` |
| A08 | note 隔离 | agent 读到自己的 note；别的 agent 读同一个 key 得到和"不存在"一样的响应 | `P0` |
| A09 | 意图匹配 | trail_shoes 意图经 UCP 目录（fixture 响应）得到两家商家；只有这两家的代理 agent 拿到 session 和授权，其余目录结果没有 | `P0` |
| A10 | 真实客户端（手动） | Claude Desktop 通过 MCP 完成一次 find_agents，活动日志里有记录，导出到 `docs/evidence/` | `P0` |
| A11 | 注入 | 商家 agent 提交"该用户是 VIP"这类文本，只成为它自己的 inferred 记录，不上卡，别的 agent 看不到 | `P0` |
| A12 | 重置复演 | reset 后用固定种子能把完整 demo 再跑一遍 | `P0` |
| A13 | 并发与幂等 | 同一 Idempotency-Key 重复请求不产生两份授权 | `P1` |
| A14 | 控制台 | 身份卡每个字段能展开看到来源 agent；能撤销一条记录 | `P1` |
| A15 | 零接入投递 | 原版 ACME 鞋店收到带文本前缀的第一条消息后，首条回复包含 42 码，且未改它任何代码 | `P1` |
| A16 | skill 生成的接入 | 在干净的 blueprint 克隆上跑 `/add-agent-cookie`，生成的 MemoryStore 读到握手字段并写回 note；其余代码未改 | `P1` |
| A17 | iMessage 主流程（手动） | 从 iMessage 一句话到付款链接（或已下单），不离开对话；用户没有输入尺码和地址；录屏存 `docs/evidence/` | `P0` |
| A18 | UCP 失败路径 | 售罄 warning 和 `requires_escalation` 都在回复里说清楚，并给 `continue_url`；不假装成功 | `P0` |
| A19 | passkey 解锁 jar | 手机 passkey 断言一次 → 工作台能签握手；未解锁 403 JAR_LOCKED | `P1` |
| A20 | 商家验签登录 | 商家用 JWKS 验签通过；篡改一字节被拒；首次见面记公钥，再见即登录 | `P1` |
| A21 | 支付单次限额 | 同一支付授权第二次使用被拒；金额超 intent.budget 被拒；商家拿不到 token | `P1` |
| A22 | 回头客 | 同一用户经两个不同个人 agent 介绍到同一商家，两次 session ID 相同；`POST /demo/reset` 后仍相同；握手和字段里没有电话、邮箱等全局标识 | `P0` |

### 比赛目标（10 月 17 日赛道页）

<table>
<thead>
<tr>
<th>赛道</th>
<th>我们怎么对上</th>
<th>额外工作</th>
</tr>
</thead>
<tbody>
<tr>
<td>Applied Intelligence</td>
<td>主赛道：真实问题、真实购买、基础设施</td>
<td>无</td>
</tr>
<tr>
<td>Photon</td>
<td>题目就是"用 Photon 2.0 做消息 agent，一个 agent 所有通道"。个人 agent 住在 iMessage 里，这是主舞台</td>
<td>B 线：Photon 线 + SDK，P0</td>
</tr>
<tr>
<td>Visa</td>
<td>真实 Shopify 结账，地址按用途只放给一家，用户自己刷卡；答辩引用 Visa 的 Trusted Agent Protocol</td>
<td>无代码；答辩口径</td>
</tr>
<tr>
<td>Cognition / Devin</td>
<td>记忆库 fork 自 Agent Memory Repo；<code>/add-agent-cookie</code> 用 Devin 在 ACME 上跑一次</td>
<td>C 线：skill + 一次录屏</td>
</tr>
<tr>
<td>Paper · Best Designed Hack</td>
<td>控制台</td>
<td>C 线：H14 之后两小时打磨</td>
</tr>
<tr>
<td>Sentry</td>
<td>工作台加 tracing 和 logs 两个产品</td>
<td>A 线：半小时，P1</td>
</tr>
<tr>
<td>GoDaddy 域名</td>
<td>注册 agentcookie 域名</td>
<td>十分钟</td>
</tr>
<tr>
<td colspan="3" class="small muted">不报：Fetch / Agentverse（要求主流程在 ASI:One 内完成，与"任何 agent 都能装"相反）、Browser Use、Intuit / Jev。</td>
</tr>
</tbody>
</table>

## 3 · Demo 是什么样子的

一个故事，三到四分钟，屏幕上同时开三样东西：左边手机投屏（iMessage），右上控制台，右下工作台和 ucp 的终端日志。

### 分镜

0:00

控制台：活动日志为空，身份卡上有语言、说话方式、鞋码 42、寄送地址（来源：个人 agent 和一家店的历史订单）。

说：每一段 agent 对话都从零开始。我们让 agent 在第一条消息之前就认识你。

0:20

手机上给 Photon 线发 iMessage：`帮我找双越野跑鞋，120 以内，周五前到。`

说：用户只做这一件事。没有说尺码，没有说地址。

0:35

终端：工作台从身份卡取 shoe_size、budget、deadline，调 `ucp catalog search`，Shopify 全球目录返回真实结果；选两家（例如 Marathon Sports 和 Shoebacca），各发一个 pairwise session 和 10 分钟授权。手机收到两条：两双真鞋，品牌、价格、到货日，各带购买链接。

说：两家真实商家，真实库存。工作台替每家店各开了一个只对它有效的 ID。店家没拿到电话，也还没拿到地址。

1:05

回 `要第二双`。终端：`ucp cart create` → `ucp checkout create` → 此刻以 purpose=checkout 从工作台读 shipping_address → 填进 `fulfillment.destinations` → `ucp checkout complete`。手机收到付款链接（`requires_escalation`）或"已下单"。控制台回执多一行：Shoebacca · shipping_address · checkout。

说：地址只在用到的那一步、只给被选中的那一家。另一家从来没拿到。用户没点过任何同意。

1:40

控制台：两家的 session ID 不同；授权剩余时间；撤销另一家，它再读就是 GRANT_REVOKED。身份卡上 shoe_size 展开，来源两条。

说：身份卡不是用户填的，是 agent 写的，后台按规则合并。用户随时能撕掉任何一张 cookie。

2:05

换个人 agent：打开 Claude Desktop（装了挂钩），说"刚才那家再来一双"。`find_agents` 再次介绍到 Shoebacca：终端显示 session ID 和 iMessage 那次相同；Shoebacca 的代理读自己的 note `last_order = Cascadia 19`，报价写"上次的 Cascadia 19，同码再来一双？"。（个人 agent 读不到商家的 note，A08；所以这一拍让商家开口，不让 Claude Desktop 去翻。）

说：换了个人 agent，商家认的还是同一个回头客，但它拿不到任何全局标识。

2:30

有自己 agent 的商家怎么办：ACME 鞋店（Anthropic commerce blueprint 原版）收到带握手前缀的第一条消息，直接按 42 码报价。然后在它的仓库跑 `/add-agent-cookie`，Devin 找到 `JsonFileMemoryStore`，生成适配类换掉。重启后日志出现 `write_note`。60–90 秒，超时放 Recorded run。

说：没装我们任何东西也认识你；装了，是 coding agent 装的，不是我们。

3:15

回到架构图：挂钩、工作台、任何 agent、任何商家。

说：Photon 负责把 agent 送到人面前，Shopify 负责卖，我们负责让对方认识你而拿不到你。

说（下一步，明确说是计划）：网页花了十年，让 cookie 成为每个请求的一部分，电商才长出来。agent 之间还缺这一层。我们要把今天的握手、字段词表和这套验收测试开放成协议，谁都能实现，用户持有。Agent Cookie。

### 演示时序

``` mermaid

sequenceDiagram
  participant U as 用户（iMessage）
  participant P as 个人 agent（Photon 线）
  participant W as 工作台
  participant S as Shopify 店（UCP）
  U->>P: 帮我找双越野跑鞋，120 以内
  P->>W: intent + 读 shoe_size, budget, deadline
  W->>S: ucp catalog search（全球目录）
  S-->>W: 真实结果
  W->>W: 选两家，各发 session + 10min 授权
  P-->>U: 两双鞋，两家店，购买链接
  U->>P: 要第二双
  P->>W: accept
  W->>S: ucp cart create → checkout create
  W->>W: get_fields(shipping_address, purpose=checkout) → 放行 + 回执
  W->>S: checkout update(destination) → complete
  S-->>W: completed 或 requires_escalation + continue_url
  P-->>U: 已下单 / 付款链接
  W->>W: write_note(last_order)
```

### 演示规则

- 开场前跑 `pnpm demo:reset`（= `agent-cookie reset` = `POST /demo/reset`）：清 SQLite 热状态，把 git 记忆库硬重置到 fixtures 的初始 commit。只在 `AGENT_COOKIE_DEMO=1` 时可用。
- 模型响应慢或出错时，切到标为 **Recorded run** 的录屏，同时展示当时的日志。预置结果不能假装现场生成。
- 我们不碰付款：用户在商家的 `continue_url` 自己刷卡。排练时不要真的付；演示时付不付由演示者决定。
- 每一句台词只说当时真实实现了的能力。

## 4 · 具体步骤

按 24 小时窗口排。四个 coding agent 并行（一个 Claude Code、两个 Codex、一个 Devin），两个人负责合并、决策和演示。每个时段有一个"阶段出口"，出口没到就按砍法处理。

### 四条并行线：按目录分家

| 线 | 跑在 | 拥有的目录（只改这些） | 任务 | 第一个出口 |
|----|----|----|----|----|
| A · 核心与工作台 | Claude Code | `packages/core` `apps/workspace` | T0 → T1 → T3 → T4 的 UCP 项 → T5 → T7 的 A 项 | H2 core 测试过；H6 curl 走完握手、读字段、被拒 |
| B · 通道与个人 agent | Codex 1 | `packages/sdk` `packages/cli` `packages/mcp` `apps/channel-photon` `skills/agent-cookie` | T2（SDK → CLI → MCP）→ Photon 线 → Claude Desktop 配置 → SKILL.md | H6 Claude Desktop 调到 get_my_card；H10 iMessage 一句话收到两双真鞋 |
| C · 演示面与验收 | Codex 2 | `apps/console` `examples/blueprint` `skills/add-agent-cookie` `fixtures` `tests/acceptance` `docs` | T6 控制台 → T4 的 ACME 项 → 验收测试 → README、视频 | H6 控制台渲染 fixtures 身份卡；H10 ACME 零接入报价 |
| D · 登录与支付（P1） | Devin | `packages/auth` `packages/pay` `apps/unlock` | TD1 jar 密钥与 passkey 解锁 → TD2 商家验签登录 → TD3 支付 token 按用途单次放行 | H8 passkey 解锁 jar 并签一条握手；H14 商家验签通过；H18 一次限额单次的测试扣款 |

- **H0–1 只有 A 线写业务代码**：types、policy、端点清单、错误码，提交。B、C 只做脚手架和 fixtures。A 线 H1 顺手提供一个读 fixtures 的 10 行假工作台，B、C 用它开工，H6 换真的。
- 四条线只通过 `packages/sdk` 调工作台；谁也不直接碰 SQLite 和 git 记忆库；`tests/acceptance` 只打 HTTP。D 线对工作台的唯一接口是两个纯函数（`signHandshake`、`authorizePayment`）和一个端点（`POST /personal/unlock`），由 A 线在契约里预留，D 线实现。
- 每条线一个分支，只往自己的目录提交；合并到 main 由人做，每两小时一次，合并前该线 `pnpm test` 必须绿。D 线的分支只有在 P0 验收全绿后才合进 main；之前 demo 不依赖它。
- 两个例外：`docs/requests.md` 所有线都可以追加一行（只追加不改）；`docs/plan.md` 只有人改（与 Artifact 同步）。
- SDK 归 B 线：A 线在 T0 冻结端点和错误码，B 线照契约写客户端；A 线需要的 curl 自测不依赖 SDK。
- 仓库根放 `AGENTS.md` 和 `CLAUDE.md`，内容相同：目录归属、契约在哪、不改别人的目录、怎么跑测试。Codex 读前者，Claude 读后者。

### 开赛前预检（人做，H0 之前）

每一项要么打勾，要么在开赛时就按砍法降级，不留到 H10 才发现。

- Photon 2.0 beta 账号和线的号码已开通；演示手机已经先给线发过一条（免费层只能回已对话的号码）。
- `ucp` CLI 0.9.1 装好，`ucp catalog search` 对 "trail running shoes" 有结果；挑好两个在库变体，响应录进 `fixtures/ucp/`。
- `ANTHROPIC_API_KEY` 可用，计划里的模型 ID 实际调得通。
- Claude Desktop 已装；`anthropics/commerce-agents` 的 retail 能在本机起来（:8000 / :3000）。
- D 线：Stripe 测试模式 key；一个 HTTPS 域名或 tunnel（WebAuthn 只在 secure context 下工作，rpID 绑定域名）。
- 确认 LA Hacks 2026 对预制资产（本计划、fixtures、设计稿）的规定。

### 环境变量与端口

| 名称 | 值 / 用途 | 谁用 |
|----|----|----|
| `AGENT_COOKIE_URL` | `http://127.0.0.1:4310` | SDK、CLI、MCP、Photon 线 |
| `AGENT_COOKIE_KEY` | 当前 agent 的钥匙 | SDK、CLI、MCP |
| `MEMORY_REPO_PATH` | 用户 git 记忆库的本地路径 | 工作台 |
| `AGENT_COOKIE_UCP` | `live` / `fixture`（读 `fixtures/ucp/`） | 工作台；验收和断网排练用 fixture |
| `AGENT_COOKIE_DEMO` | `1` 时开放 `POST /demo/reset` | 工作台 |
| `AGENT_COOKIE_TEST` | `1` 时开放 `POST /test/clock` | 工作台；只在验收里开 |
| `OPT_OUT_INSTRUMENTATION` | `true` | ucp CLI |
| `ANTHROPIC_API_KEY` | 自建商家 agent、Photon 线的模型 | A、B |
| `STRIPE_SECRET_KEY` | 测试模式 | D 线，P1 |
| `SENTRY_DSN` | tracing + logs | A 线，P1 |
| Photon 凭据 | 名字以 Photon 文档为准 | B 线 |

端口：工作台 4310（只听 127.0.0.1）；MCP streamable HTTP 4311；控制台 5173（Vite 默认）；ACME 8000 / 3000；`apps/unlock` 4312，只经 HTTPS tunnel 暴露给手机。

H0–2T0 · 契约冻结`P0`A 线先行，B、C 搭脚手架
初始化 pnpm 单仓库：`packages/core sdk mcp`，`apps/workspace console`，`examples/*`，`fixtures`，`tests/acceptance`。锁 Node 22，vitest，tsx。 `packages/core/src/types.ts`：写下本文"接口与数据"一节的全部类型，一字不改。 `packages/core/src/policy.ts`：字段策略表（下文表格）导出为常量；`canRead(category, field, purpose) → "allow" | "deny"`（auto 字段任何用途都 allow；purpose 字段只在声明用途匹配时 allow）；`canWrite(category, field) → boolean`。 `packages/core/src/merge.ts`：`mergeCard(contributions) → { card: CardField[], candidates: Candidate[] }`，按规则：同一 field+value 有 ≥2 个不同 agentId 且 basis≠inferred → 上卡；personal 的 stated 单源 → 上卡（confidence medium）；其余进候选；inferred 永不。**时间规则：**同一字段多个合格值时最新的赢，旧值标 superseded 留在历史；新值只有一个来源时 confidence=medium 并带 `changedRecently`；`lastSupportedAt` 超过 180 天降为 medium，超过 365 天掉卡；personal stated 永远立即覆盖。 `packages/core/src/render.ts`：`renderCard(card) → CARD.md 文本` 和 `parseContributions(md) → Contribution[]`，格式与 Agent Memory Repo 的"一行一条 + \[key: value\]"一致。各 3 个用例，往返无损。 `packages/core/src/session.ts`：`deriveSessionId(userSecret, merchantKey)` = base32(HMAC-SHA256).slice(0,8)，`merchantKey = agent.domain ?? agent.agentId`（UCP 代理用 domain，重置和重新注册后回头客不变）。所有涉及时间的纯函数显式接收 `now`，不读系统时钟。 policy、merge、session 各写 3 个 vitest 用例，render 往返 3 个（A02、A03 的核心断言在这里先过）。 `fixtures/`：1 个用户、3 条贡献记录（lang/tone/shoe_size）、3 个 agent 注册项、1 个 Sample 地址。 把验收清单 A01–A22 全部写成 `tests/acceptance/*.test.ts` 的空壳（`it.todo`），编号和标题一致；A10、A17 写成指向 `docs/evidence/` 的说明。

出口：`pnpm test` 跑过 core 的 12 个用例；类型、策略表、接口名在双方的代码里完全一致。

H2–6T1 · 工作台骨架`P0`A 线 · Claude Code
SQLite 只建热状态表：agents, users, sessions, grants, intents, quotes, activity。 `apps/workspace/src/repo.ts`：用 simple-git 打开 `MEMORY_REPO_PATH`；`appendContribution(agentId, line)`、`writeNote(sessionId, kv)`、`appendReceipt(line)`、`regenerateCard()`，每次写一个 commit，author 为写入者，trailer 带 `Agent-Cookie-Sig`。fixtures 以一个初始 commit 灌入。 鉴权中间件：`Authorization: Bearer <key>` → 查 agents 表 → 挂上 `{agentId, category, role}`。无钥匙 401 AUTH_REQUIRED。 `POST /agents/register`、`POST /agent/contributions`（经 canWrite 过滤）、`GET /personal/card`。 合并任务：每次写入 contributions 后同步调用 `mergeCard` 重算 card_fields（先不做定时，写入即合并）。 sessions + grants：`introduce(userId, agentId)` 内部函数 → 生成 session、level-0 grant（策略表里 auto 字段，10 分钟）。 `GET /agent/handshake`、`GET /agent/fields`：每次读都检查 grant 存在、未过期、未撤销；字段按 canRead(category, field, purpose) 分流为返回 / 403。 activity 表：每个端点写一行 `{event, actor, object, result, reason}`，不写字段值。 让 A01、A02、A04、A05、A06 从 todo 变成通过。

出口：curl 能注册 agent、写记录、看到合并后的卡、拿握手、读字段并被正确拒绝。

H2–6T2 · 挂钩 + SDK + 接上 Claude Desktop`P0`B 线 · Codex 1（console 脚手架归 C 线）
`packages/sdk`：`new WorkspaceClient({ baseUrl, key })`，每个端点一个方法，错误统一抛 `WorkspaceError { status, code, message }`。 `packages/cli`：`agent-cookie card | contribute | find | accept | read --as --purpose | grants | revoke | receipts | reset`，每个子命令一行调 SDK，输出 JSON（`--pretty` 给人看）。 `packages/mcp`：启动时读 `AGENT_COOKIE_URL`、`AGENT_COOKIE_KEY`，调 `GET /me` 拿角色，按角色注册工具（工具表见下文）。 stdio 传输跑通；写 `claude_desktop_config.json` 示例到 README。 在 Claude Desktop 里调用 `get_my_card`，看到 fixtures 里的三个字段。 `apps/console` 脚手架：Vite + React，一个页面先把 `GET /personal/card` 的 JSON 渲染成表。 streamable HTTP 传输跑通（商家 agent 用），端口 4311。

出口：Claude Desktop → MCP → 工作台 → SQLite 闭环；A10 的前半段（真实客户端调用有日志）成立。

H6–10T3 · 意图、匹配、报价、授权请求`P0`A 线 · Claude Code
`POST /personal/intents`：存 intent；按 `agents.capabilities` 包含 `intent.kind` 匹配；对每个匹配 agent 调 `introduce`；向其 `callbackUrl` POST `{type:"introduce", sessionId, handshake, intent}`（intent 只含公开部分；UCP 代理没有 callbackUrl，由工作台内部处理）。 `POST /agent/quotes`；`GET /personal/intents/:id/quotes`（长轮询最多 20 秒，凑齐或超时返回）。 `POST /personal/quotes/:id/accept` → 通知对应 agent 的 callbackUrl `{type:"accepted", sessionId, quoteId}`。 `GET /agent/fields` 接受 `purpose` 参数；purpose 字段在用途匹配时放行并写一条 activity（含用途），不匹配返回 403 PURPOSE_MISMATCH；`GET /personal/receipts` 返回最近的敏感字段读取回执。 A09 通过；A05 的 purpose 分支通过。

出口：用 curl 扮演两家店，从 intent 到两份 quote 到 accept 到按 checkout 用途读到地址，一条线走通。

H6–10T4 · 真实商家（UCP）、Photon 通道、ACME`P0`A 线 UCP · B 线 Photon · C 线 ACME
A：`npm i -g @shopify/ucp-cli`（0.9.1 已验证），`ucp profile init --name agent`，`OPT_OUT_INSTRUMENTATION=true`。工作台用子进程调 CLI，解析 JSON。 A：每个 `seller.domain` 首次出现时注册为代理 agent（见"UCP 商家：工作台代理"）；ucp 调用在 `AGENT_COOKIE_UCP=fixture` 时读 `fixtures/ucp/`。 A：`POST /personal/intents` 对 kind=trail_shoes：从身份卡取 shoe_size / budget / deadline → `ucp catalog search`（query、context.intent、filters.price、ships_to）→ 取前两个不同 `seller.domain` 的在库变体 → 为每家建 session + 授权 → 存为两条 quote（title、price、eta、seller、variant、checkout_url）。 A：`POST /personal/quotes/:id/accept`：`ucp cart create --business` → `checkout create --cart-id` → `get_fields(shipping_address, purpose=checkout)`（写回执）→ `checkout update` 填 `fulfillment.methods[].destinations[]` 和 `buyer.email` → `checkout complete`。`completed` 记订单；`requires_escalation` 返回 `continue_url`；售罄 warning 原样转给用户。成功后 `write_note(last_order)`。 B：`apps/channel-photon`：Photon 2.0 beta 收 iMessage → 调 SDK `find` / `accept` → 回两条鞋的消息（品牌、价格、到货、链接）和一条结果消息。免费层只能回已对话的号码，演示前先让手机给线发一条。 C：克隆 `anthropics/commerce-agents`，跑通 retail（:8000/:3000）。工作台 `introduce` 对注册项带 `chatEndpoint` 的商家改为文本前缀投递（A 线提供端点，C 线配置）。 C：`fixtures/expected/agent_cookie_memory_store.py` 参考实现（约 80 行），只用于验收 skill 输出。 A：排练前锁定两个在库变体的 ID 写进 fixtures（上次 Cascadia 11 码售罄了），演示时优先用，搜索结果变化时回退到实时结果。

出口：iMessage 一句话 → 两双真鞋 → 回"要第二双" → 付款链接或已下单；控制台回执一行。

H10–14T5 · note、过期、撤销、错误契约`P0`A 线 · Claude Code
`PUT/GET /agent/notes/:key`，按 (agentId, userId, key) 隔离；别人读返回和不存在相同的 404。 过期：`expiresAt` 用服务器时间判断；`AGENT_COOKIE_TEST=1` 时开放 `POST /test/clock { offsetMs }`，其他情况下该端点不存在。`POST /personal/grants/:id/revoke`。 错误契约统一：401 AUTH_REQUIRED、403 SCOPE_DENIED / GRANT_EXPIRED / GRANT_REVOKED / PURPOSE_MISMATCH、404 NOT_FOUND、422 MISSING_FIELD、409 IDEMPOTENCY_CONFLICT。未授权主体得到的拒绝里不含任何字段名或条目名。 A06、A07、A08、A11 通过。A11 的做法：商家提交 `{field:"vip", value:"true", basis:"observed"}` → canWrite 为 false → 降级存为 inferred 或拒绝，均不进卡。 `POST /demo/reset`：清表、重灌 fixtures、git 记忆库硬重置到 fixtures 初始 commit；A12、A22 通过。

出口：A01–A12 里除 A10 外全部绿色，A22 绿色。

H10–14T6 · 控制台、skill、个人 agent 文案`P0`B 线（个人 agent 文案、agent-cookie skill）/ C 线（控制台、add-agent-cookie）
控制台三个视图：身份卡（字段可展开看来源记录，每条可撤）、授权（`GET /personal/grants`：agent、字段、用途、剩余时间、撤销按钮）、活动（倒序，可展开 reason）。顶部"重置演示"。 每 2 秒拉一次，不做 websocket。 个人 agent 侧：`find_agents` / `accept_quote` 的返回里附上最近的回执（谁、读了什么、什么用途），让 Claude Desktop 顺口告诉用户，不需要用户操作。 把 Claude Desktop 用到的工具描述改到最短、最不会被误用（描述里写清"此工具会把用户的意图发给外部商家"）。 `skills/agent-cookie/SKILL.md`：会话开始跑 `agent-cookie card`；学到稳定偏好跑 `agent-cookie contribute`；需要外部服务跑 `agent-cookie find`；永远不把身份卡贴进发给别的 agent 的消息。用 `npx skills add` 装进 Claude Code，用 `devin plugins install` 装进 Devin，各跑一次。 `skills/add-agent-cookie/SKILL.md`：给 coding agent 的接入手册（找 session 标识 → 找 memory / preferences 读写点 → 用 SDK 包一层 → 保留原有写过滤 → 加测试），附 blueprint 作为已验证例子。在一份干净的 blueprint 克隆上用 Claude Code 跑通一次，录屏；对照 `fixtures/expected/` 验收（A16）。

出口：完整 demo 从 reset 开始跑通一遍，包括 Claude Desktop 换 agent 和控制台的撤销。

H2–18TD · 登录与支付（D 线）`P1`D 线 · Devin
原则：passkey 不进 cookie，卡号不进任何地方。jar 自己是一把密钥，用户的 passkey 只用来解锁 jar；支付走提供方的 token，按用途、按金额、单次放行。

**TD1 · jar 密钥与 passkey 解锁（H2–8）。**`packages/auth`：jar 生成 Ed25519 密钥对，私钥加密存本机；`apps/unlock` 一个手机能开的页面，用 `@simplewebauthn/server` + browser 做 passkey 注册和断言，断言成功后解锁 jar 私钥 N 分钟（手机经 HTTPS tunnel 访问该页，工作台本身仍只听 127.0.0.1）；`signHandshake(handshake) → { sig, kid }`。验收 A19：手机 Face ID 一次 → 工作台能签握手；未解锁时签名接口 403 JAR_LOCKED。 **TD2 · 商家验签登录（H8–14）。**握手增加 `sig` 和 `kid`；工作台暴露 `GET /.well-known/agent-cookie-jwks.json`；商家侧 SDK 加 `verifyHandshake()`；首次见面把 jar 公钥记在该商家的 note 里，之后验签即登录（"Sign in with Agent Cookie"，等价于 OIDC pairwise subject）。ACME 的 Tier 2 参考实现改为验签后才读字段。验收 A20：篡改一个字节的握手被拒。 **TD3 · 支付凭据按用途单次放行（H10–18）。**`packages/pay`：身份卡字段 `payment_method` 只存提供方 token 引用（Stripe 测试模式的 payment method id；Visa 沙盒接得上就换）。策略：purpose=payment、金额 ≤ intent.budget、单次有效、只给被接受报价的那一家。`authorizePayment({ sessionId, amount, currency })` 由工作台替用户向提供方发起，商家只拿到授权结果，不拿 token。回执写金额。验收 A21：同一授权第二次使用被拒；超预算被拒。 **TD4 · 接到 demo（H18 前）。**UCP 真实商家的 checkout 若接受 `payment.instruments` 的委托支付则接入，否则保持 `requires_escalation`（用户自己刷）；ACME 的 checkout handoff 用 Stripe 测试模式走完 TD3。demo 第 4 拍据此二选一，台词如实。

出口：A19–A21 绿；至少一条真实路径（ACME + Stripe 测试模式）从握手验签到限额单次扣款跑通。没到出口，demo 只讲设计，不演。

H14–18T7 · 验收、幂等、稳定性`P0`A、B、C 三线（D 线按自己的出口走）
A：Idempotency-Key 落在 intents、quotes、quotes/accept；A13 通过。 A：商家 callback 失败重试 3 次，失败写 activity，不阻塞别的商家。 B：从 reset 连跑 demo 两遍，记录每一步耗时；超过 20 秒的步骤换 haiku 或缩短提示。 B：录一遍完整运行，标 Recorded run，作为备用。 A10：从 Claude Desktop 跑的那次，把活动日志导出存进 `docs/evidence/`。

出口：P0 验收全绿，A13 绿；demo 两遍无人工干预。

H18–21T8 · 加分项（只在 T7 出口达成后）`P1`可分头
A：Sentry：工作台接 tracing + logs 两个产品，截一张 ucp 调用的 trace。 C：Paper 赛道：控制台两小时打磨（间距、空状态文案、键盘可达、320 宽度）。 C：Devin 跑一次 `/add-agent-cookie` 并录屏（Cognition 赛道）；Claude Code 跑的那次作为备用。 人：GoDaddy 注册 agentcookie 域名；Photon 线绑一个好记的名字。 P2：Jev 判断"声明用途与当前对话是否相称"，只写警告回执。

出口：每一项要么完整跑通，要么完全不提。

H21–24T9 · 冻结与提交`P0`四线（D 线未达出口则不合并）
冻结功能。只许修 bug、改文案。 README：一条命令启动（`pnpm dev` 起工作台 + 控制台 + Photon 线）、ucp CLI 安装、Claude Desktop 配置、环境变量名、重置命令、已支持的客户端。 提交材料：简介、代码入口、架构图、测试结果截图、演示视频、第三方依赖、预制资产说明（本计划和 fixtures 属于赛前材料）。 三到四分钟排练两遍，按正式时长调整。

出口：视频、README、代码入口三者一致。

### 砍法

<table>
<thead>
<tr>
<th>时间点</th>
<th>如果</th>
<th>那么</th>
</tr>
</thead>
<tbody>
<tr>
<td>H6</td>
<td>Claude Desktop → MCP → 工作台还没闭环</td>
<td>控制台退化成一个 JSON 页面；B 全力修挂钩</td>
</tr>
<tr>
<td>H8</td>
<td>blueprint 跑不起来，或 memory 钩子不如文档所说</td>
<td>ACME 一拍整个删掉；C 线全力转验收和控制台</td>
</tr>
<tr>
<td>H10</td>
<td>Photon 2.0 beta 收不到或发不出</td>
<td>个人 agent 改为 Claude Desktop 主演，iMessage 改为录屏或删掉；Photon 赛道放弃</td>
</tr>
<tr>
<td>H10</td>
<td>UCP 目录结果不稳定或商家 checkout 报错</td>
<td>用 fixtures 里锁定的两个变体；仍不行则只演到购买链接，不演 checkout complete</td>
</tr>
<tr>
<td>H10</td>
<td>git 写入路径不稳（锁、并发 commit）</td>
<td>长期数据也退回 SQLite，保留 CARD.md 导出命令；fork 故事改为"格式兼容"</td>
</tr>
<tr>
<td>H14</td>
<td>完整 demo 还没跑通一遍</td>
<td>砍掉 ACME 一拍和 Claude Desktop 换 agent 一拍，只保留 iMessage 主线 + 控制台撤销</td>
</tr>
<tr>
<td>H18</td>
<td>P0 验收未全绿</td>
<td>T8 全部取消；D 线分支不合并，demo 只讲登录与支付的设计</td>
</tr>
<tr>
<td>任何时候</td>
<td colspan="2">不砍：握手先于消息、每家一个 session ID、过期、撤销。这四样没了就不是 cookie。</td>
</tr>
</tbody>
</table>

## 5 · 接口与数据

这一节是 T0 要冻结的契约。后面所有任务都引用这里的名字，不另起名。

### 类型（packages/core/src/types.ts）

    export type Basis = "observed" | "stated" | "inferred";
    export type Category = "personal" | "shoe";   // pharmacy、hotel 已于 10 月 17 日砍掉，赛后再加
    export type Role = "personal" | "merchant";  // category === "personal" ? "personal" : "merchant"
    export type Field =
      | "lang" | "tone" | "length"
      | "shoe_size" | "budget" | "deadline"
      | "shipping_address"
      | "payment_method";   // 只存支付提供方的 token 引用，永远不是卡号

    export interface Agent { agentId: string; name: string; category: Category;
      capabilities: string[]; callbackUrl?: string;
      chatEndpoint?: string;   // 有则走 Tier 0 文本前缀投递（ACME）
      domain?: string;         // UCP 代理的 seller.domain；session ID 按它推导
      createdAt: string; }

    export interface Contribution { id: string; userId: string; agentId: string;
      field: Field; value: string; basis: Basis; createdAt: string; revokedAt?: string; }

    export interface CardField { field: Field; value: string;
      confidence: "high" | "medium"; sources: string[]; updatedAt: string;
      lastSupportedAt: string; changedRecently: boolean; }

    export interface Candidate { field: Field; value: string; sources: string[]; reason: "single_source" | "inferred"; }

    export interface Session { sessionId: string; userId: string; agentId: string; createdAt: string; }

    export interface Grant { id: string; sessionId: string; fields: Field[];
      purpose: string; expiresAt: string; revokedAt?: string; }

    export interface Handshake { v: 1; sessionId: string; jar: string; lang: string; tone: string;
      length: string; available: Field[]; expiresAt: string; sig?: string; kid?: string; }  // sig/kid 由 D 线加   // jar = 工作台 API 地址，商家据此调用，无需任何发现机制

    export interface Intent { id: string; userId: string; kind: string;
      public: Record<string, string>; expiresAt: string; }

    export interface Quote { id: string; intentId: string; agentId: string;
      text: string; price: number; currency: "USD"; etaDate: string;
      title?: string; seller?: string; variantId?: string; checkoutUrl?: string; }  // UCP 报价

    export interface Receipt { id: string; sessionId: string; agentId: string;
      fields: Field[]; purpose: string; amount?: number; createdAt: string; }  // amount 由 D 线支付授权填

    // D 线预留（P1），A 线只放类型和签名，不实现
    export interface PaymentAuthorization { id: string; sessionId: string; quoteId: string;
      amount: number; currency: "USD"; status: "authorized" | "declined" | "used"; createdAt: string; }
    export type SignHandshake = (h: Handshake) => Promise<{ sig: string; kid: string }>;
    export type AuthorizePayment = (a: { sessionId: string; quoteId: string; amount: number; currency: "USD" }) => Promise<PaymentAuthorization>;

### 字段策略表（packages/core/src/policy.ts）

| 类别 | 随握手可读（auto） | 按用途可读（purpose） | 可写的字段 |
|----|----|----|----|
| personal | 全部 | 无 | 全部，basis 可为 stated |
| shoe | lang, tone, length, shoe_size, budget, deadline | shipping_address，仅 purpose=checkout | shoe_size（observed） |
| 任何商家类别 | — | payment_method，仅 purpose=payment，且金额 ≤ intent.budget、单次有效、只给被接受报价的那一家；放行的是授权结果，不是 token | 无 |

表里没有的组合一律 deny。pharmacy、hotel 两类连同 date_of_birth、allergies、diet 字段已砍掉；下文"药店"只作隔离的举例。用途由商家声明，工作台只核对用途与字段是否相符，并把每次放行写成回执给用户。电话号码不是字段，永远不进卡。

### 工作台 HTTP（apps/workspace，127.0.0.1:4310）

| 方法与路径 | 调用方 | 行为 |
|----|----|----|
| POST /agents/register | 任何人（本机） | 建 agent，返回 agentId 和一次性显示的 key |
| GET /me | 持钥匙者 | 返回 agentId、category、role |
| POST /personal/intents | personal | 存意图，匹配，介绍，通知商家；返回 intentId |
| GET /personal/intents/:id/quotes | personal | 长轮询报价，最多 20 秒 |
| POST /personal/quotes/:id/accept | personal | 通知该商家 accepted |
| GET /personal/card | personal | 身份卡 + 候选区 |
| GET /personal/receipts | personal / 控制台 | 最近的敏感字段读取回执（谁、什么字段、什么用途） |
| POST /personal/grants/:id/revoke | personal / 控制台 | 立即撤销 |
| POST /personal/contributions | personal | 记一条 stated（MCP `record`、CLI `contribute`），立即重算卡 |
| GET /personal/grants | personal / 控制台 | 当前授权：agent、字段、用途、剩余时间；不含值 |
| POST /personal/contributions/:id/revoke | personal / 控制台 | 撤一条记录并重算卡 |
| GET /agent/handshake?sessionId= | 商家 | 返回 Handshake，只有字段名 |
| GET /agent/fields?sessionId=&fields=&purpose= | 商家 | 200 值 / 403 SCOPE_DENIED / 403 PURPOSE_MISMATCH；purpose 字段放行时写回执 |
| POST /agent/quotes | 商家 | 提交报价 |
| POST /agent/contributions | 商家 | 经 canWrite 过滤后入库，立即重算卡 |
| PUT / GET /agent/notes/:key?sessionId= | 商家 | 自己的 cookie note |
| GET /owner/activity | 控制台 | 事件列表，不含字段值 |
| POST /demo/reset | 控制台 / CLI | 清表、重灌 fixtures、记忆库重置；仅 `AGENT_COOKIE_DEMO=1` |
| POST /test/clock | 验收测试 | `{ offsetMs }` 拨服务器时钟；仅 `AGENT_COOKIE_TEST=1` |
| POST /personal/unlock | 手机解锁页 | D 线 P1：passkey 断言通过后解锁 jar N 分钟 |
| GET /.well-known/agent-cookie-jwks.json | 任何人 | D 线 P1：jar 公钥 |

写操作带 `Idempotency-Key`。商家的 callbackUrl 收到两种 POST：`{type:"introduce", sessionId, handshake, intent}` 和 `{type:"accepted", sessionId, quoteId}`。

### MCP 工具（packages/mcp）

#### role = personal（Claude Desktop）

- `find_agents({ kind, public })` → 介绍并等报价，返回 quotes 和最近的 receipts（只用于告知，用户无需批准）
- `accept_quote({ quoteId })` → 返回结果（completed / continue_url）和最近的 receipts
- `recent_receipts()`
- `get_my_card()`
- `record({ field, value })` → basis 固定为 stated
- `revoke_grant({ grantId })`

#### role = merchant（商家 agent）

- `get_handshake({ sessionId })`
- `get_fields({ sessionId, fields, purpose })`
- `submit_quote({ intentId, text, price, etaDate })`
- `contribute({ field, value, basis })`
- `write_note({ sessionId, key, value })` / `read_note({ sessionId, key })`

### 网站 cookie 的每一项功能，在这里的对应

| 网站 cookie 做的事 | Agent Cookie 里的对应 | 状态 |
|----|----|----|
| 会话 / 保持登录 | 握手里的 session ID + 10 分钟授权 | P0 |
| 记住我 | session ID 长期不变，授权短期；回头客靠 ID 认 | P0 |
| 偏好 | 身份卡字段，随握手或按用途给 | P0 |
| 购物车跨会话 | 商家自己的 note（last_cart、last_order） | P0 |
| 用户标识 / 追踪 ID | 每商家一个 pairwise ID，故意拼不起来 | P0，有意反着做 |
| 同意记录 | 回执 | P0 |
| CSRF / 防伪造 | 每 agent 一把钥匙，服务端核对；D 线加握手签名 | P0 / P1 |
| 设备信任 / 风控 | 该 session 的成交与被拒历史 | P1 |
| 第三方 cookie | 不提供 | 永远不做 |
| 登录凭据（密码、passkey） | jar 自己是一把密钥，用户 passkey 只解锁 jar；商家验签即登录 | P1（TD1、TD2） |
| 支付凭据 | 只存提供方 token 引用；按用途、限额、单次放行授权结果 | P1（TD3、TD4） |

#### Passkey：为什么不是"把 passkey 存进 cookie"

passkey 绑定设备，agent 在云端没法替你按 Face ID。所以 jar 自己持有一对密钥，商家第一次见面记下 jar 的公钥（和网站注册 passkey 是同一个动作），以后验签即登录；用户的 passkey 只用来解锁 jar，人只在最上面按一次。商家坚持要人的 passkey 时，安全交接到用户手机，cookie 记下"这家需要人亲自过一次"。

#### 支付：为什么不存卡号

网站也从不把卡号放进 cookie，放的是支付服务商的 token。我们照做：`payment_method` 只是 token 引用；放行的不是 token 而是工作台替用户发起的一次授权，带金额上限、单次有效、只给被选中的那一家；商家只看到授权结果。没有 token 时退回 `requires_escalation`，用户在商家页面自己刷。这和 UCP 的 `payment.instruments`、Visa 的 Trusted Agent Protocol 都对得上。

### 规模与时间规则

设计里没有任何东西需要"浏览"，全部按地址取；每个值都带日期。

| 对象 | 上限 | 过期与压缩 |
|----|----|----|
| 握手 | 四行 | 读取时计算，从不缓存 |
| 身份卡 | 只有标准字段，几十个 | lastSupportedAt \> 180 天降 medium，\> 365 天掉卡 |
| 一个商家的 note | 键值对，≤ 2 KB（对标浏览器 cookie 的 4 KB） | 每个键 12 个月未读未写即删除。要历史的商家自己存，用 pairwise ID 做键 |
| contributions/\*.md | 每字段保留现值 + 最近 3 条 superseded | Dreaming 定期把其余移到 archive/ |

#### 偏好会变，怎么办

| 种类     | 例子                     | 变化频率 | 放在哪                         |
|----------|--------------------------|----------|--------------------------------|
| 特征     | 鞋码、语言、生日         | 很少     | 身份卡，high                   |
| 慢偏好   | 说话方式、常用预算、品牌 | 按月     | 身份卡，带衰减                 |
| 当下偏好 | "这次 200 以内""要红的"  | 每个任务 | **intent**，随任务过期，不进卡 |

- **intent 字段遮盖 card 字段。**intent 说 budget=200，商家读到 200，不是卡上的"常用预算"。卡是默认值，intent 是覆盖。
- **最新合格值赢。**去年两家店观察 42，本周一家店观察 43：卡翻到 43（medium，changedRecently），第二个来源确认后回到 high。旧值标 superseded 留在历史，翻错可撤。
- **用户是最快的路径。**对自己的 agent 说"我现在 43 了"，personal stated 规则立即上卡，覆盖一切。
- **商家的 note 只放关系事实**（"6 月买过 Ridge Runner"），不放特征。把鞋码写进 note 而不读卡的商家，得到的就是网站信任旧 cookie 值的结果。

### 与 OAuth / MCP 的对应（命名即可，赛后一天的工作）

| 我们的 | 标准里的 |
|----|----|
| 授权（字段、用途、10 分钟） | OAuth access token，scope 形如 `field:shipping_address purpose:checkout`，短 exp |
| 每商家一个 session ID | OIDC pairwise subject identifier |
| 撤销 / 每次读都检查 | RFC 7009 revocation / RFC 7662 introspection |
| 商家钥匙 | OAuth client credentials |
| 握手 | MCP 请求的 `_meta["agent-cookie"]`；A2A 消息的 metadata |

赛后暴露 `/.well-known/oauth-authorization-server`，标准 OAuth 客户端即可自动配置。**发现：**外呼场景（本周末的 demo）不需要任何发现机制，握手里带 `jar` 地址；记忆库本身永远不被发现，商家只知道 API 端点。入站场景（商家先联系用户）用 WebFinger（`acct:user@domain` → jar）和手机号哈希目录，属于联邦层，有了第二个 jar 再做。

### 错误契约

| HTTP · code | 含义 | 调用方该做什么 |
|----|----|----|
| 401 AUTH_REQUIRED | 没有或无效钥匙 | 检查环境变量 |
| 403 SCOPE_DENIED | 策略不允许该类别读/写此字段 | 不要重试；换一种做法 |
| 403 GRANT_EXPIRED | 授权到期 | 需要新的介绍 |
| 403 GRANT_REVOKED | 用户撤销 | 停止；不要再请求 |
| 403 PURPOSE_MISMATCH | 声明的用途与该字段的策略不符 | 只在真正用到的那一步、用正确的用途再读 |
| 404 NOT_FOUND | 不存在或无权知道是否存在 | 按不存在处理 |
| 409 IDEMPOTENCY_CONFLICT | 同键不同内容 | 换新键 |
| 422 MISSING_FIELD | 请求缺必要字段 | 补字段 |
| 502 UPSTREAM_ERROR | ucp / Photon / 支付提供方失败 | 有 continue_url 就原样给用户；不假装成功 |
| 403 JAR_LOCKED | D 线：jar 未解锁，不能签名 | 让用户在手机上解锁一次 |
| 403 AUTHORIZATION_USED | D 线：单次支付授权已用过 | 需要新的授权 |
| 403 OVER_BUDGET | D 线：金额超过 intent.budget | 不要重试；告诉用户 |

## 6 · 风险与边界

### 主要风险

- **Claude Desktop 的 MCP 行为。**它什么时候调工具、怎么转述回执，不完全可控。对策：工具描述写死用途；T2 就接上，不留到后面。
- **商家 agent 的模型不稳定。**对策：H10 砍法，退成确定性脚本。
- **长轮询和 callback 的时序。**对策：所有等待都有超时；凑不齐也返回已有报价。
- **时间。**任务清单总量大于 24 小时的舒适区。对策：出口和砍法是硬规则，不讨论。
- **Photon 2.0 beta。**刚开放，文档少，免费层只能回已对话的号码。对策：H10 砍法；开赛第一小时就让 B 线把一条消息收发跑通。
- **UCP 的实时库存。**排练时在库的变体演示时可能售罄。对策：T4-6 锁两个变体 + 实时回退；售罄本身也是 A18 要演的失败路径。
- **手机与公网访问。**工作台只听 127.0.0.1，但 passkey 页要手机能开、要 HTTPS。对策：只把 `apps/unlock` 经 tunnel 暴露，预检里定好域名；没有就 D 线只演桌面浏览器上的 passkey。
- **Tier 0 前缀把 auto 值写进对方的对话记录。**对策：只放该类别的 auto 字段，每次投递写回执；这是零接入的代价，台词如实说。
- **git 写入并发。**多个商家同时写会排队 commit。对策：工作台内单队列串行提交，按写入者分文件所以永不冲突；H10 砍法兜底。

### 这个周末不做

- P0 不碰付款（用户在商家 continue_url 自己刷卡），P1 的 D 线按上文接 Stripe 测试模式或 Visa 沙盒；不做 Photon A2A 群聊、Browser Use、Agentverse、文件来源 hash、跨设备、多用户托管、组织权限。
- 从商家对话里提取记录（只从个人 agent 的对话提取）。
- 通用向量搜索、自动归档聊天记录。
- 任何形式的"防篡改审计"宣传。本机管理员能改 SQLite。

### 我们能保证什么，不能保证什么

握手和授权里没有数据，只有引用。商家每次要值都得回工作台读，判断权在服务端。所以有一半可以绝对保证，另一半任何系统都做不到。

| 能绝对保证 | 怎么做到 | 验收 |
|----|----|----|
| 过期后读不到 | 授权记录在服务端，`expiresAt` 用服务器时钟比较；商家传来的时间一律不看。缓存的握手文本过期后毫无用处，因为里面只有字段名 | A06：注入时钟拨到 10 分 1 秒，读取必须 403 GRANT_EXPIRED |
| 撤销后读不到 | 撤销写 `revokedAt`，下一次读立即被拒。因此授权必须有服务端状态，不能只发自包含的签名 token | A07 |
| 令牌不可伪造 | session ID 由 HMAC(用户密钥, agentId) 推导，猜不出别人的，造不出新的 | A03 |

| 不能保证 | 原因 |
|----|----|
| 收回已经给出的值 | 商家第 3 分钟读到的鞋码和地址，可以存进它自己的数据库或 agent memory。网站 cookie 同样收不回网站数据库里的订单。我们只能不再给新的 |

### 商家把看到的写进自己的 memory 怎么办

拦不住，所以不靠拦。目标是：它记了，也造不成伤害。四层，前两层在本周末的 P0 里，后两层是赛后。

| 层 | 做法 | 效果 | 何时 |
|----|----|----|----|
| 1 · 拼不起来 | 每家店的 session ID 不同且不可互推；字段里永远没有电话、邮箱等全局标识 | 鞋店记住"k7f2 穿 42 码"，药店记住"p93x 过敏"，两家数据库合并也对不上同一个人。这是唯一能绝对做到的一层，也是最重要的一层 | `P0` T0 session.ts、policy.ts |
| 2 · 不值钱 | 握手只有字段名；值只在用到的那一步、用途相符时给；身份卡随时间变化，快照会过时 | 没走到结账的店没有地址可记；必须给的本来就必须给（寄货要地址）；值钱的是"能持续读"，不是"读过一次" | `P0` T1、T3、T5 |
| 3 · 没必要自己记 | 商家可以把"上次买了 Ridge Runner 42"写进工作台里自己的 note，只有它能读，下次随 session ID 一起回来 | 合规的路比自建用户库更省事、更准。拦不住的用劝的，这正是网站 cookie 把数据放服务端的原始思路 | `P0` T5 notes |
| 4 · 查得出、踢得掉 | 每次放行写回执；低风险字段给每家店略有不同的金丝雀版本（地址写法、邮箱别名）；注册时签接入条款，查实滥用吊销钥匙 | 数据从哪漏出去一看便知；被吊销的 agent 收不到任何介绍 | `P2` 回执在 T3；金丝雀和条款赛后 |

**答辩口径：**不说"我们保证数据不被保留"，没人能保证。说：对方能记住它看到的，这和网站一样，法律管这个。我们管的是三件法律管不了的事：它看到的尽量少、看到的拼不成一个人、它没有理由自己记。

合规提醒：本计划、fixtures 内容和设计稿是赛前准备材料，提交时按本届规则披露。正式参赛代码从比赛开始计时写。请在开赛前确认 LA Hacks 2026 对预制资产的具体规定。

### 已经定下的事（本计划的前提）

- 身份卡由 agent 写、后台合并，用户只有查看和撤销。
- 用户不需要对任何读取点头。敏感字段按声明用途与策略核对后自动放行，每次放行给用户一条回执。
- 用户没有任何"加入"动作；入口是 agent 安装挂钩。
- 比赛期间工作台由我们托管在演示机器；赛后自托管只留接口。
- 队友的"工作交接"方案是另一个产品，可共用授权与过期机制，本周末不做。
- Jev 只用于"用途是否相称"的警告，不用于"能不能给"，且是 P2。
- 长期数据存在 fork 自 Agent Memory Repo 的 git 记忆库里；git 是存储和溯源层，不是传输层；商家永远不碰 git。
- 交付形态：一个 SDK，三个壳（CLI、MCP、Skill）。给陌生人的只有 MCP 和 SDK；skill 只包装 CLI。
- 当下偏好放 intent，不进卡；intent 字段遮盖 card 字段；最新合格值赢；用户亲口说的立即覆盖。
- 登录与支付做，但在 D 线（Devin）、P1：passkey 只解锁 jar，jar 密钥签握手，商家验签即登录；卡号不存，只存支付 token 引用，按用途、限额、单次放行授权结果。D 线不合并进 main 直到 P0 全绿。
- 10 月 17 日：不报 Fetch / Agentverse，不用 Browser Use；Photon 是主舞台；商家是 UCP 上的真实 Shopify 店；药店和酒店去掉，隔离由两家真实商家证明；四个 coding agent 按目录分四条线（D 线 P1）。

示例里的店铺、价格、地址、鞋码都是 Sample。接口为 v0.1 拟定契约，T0 冻结后再改要双方同意。

## 7 · 开放问题（需要人拍板）

v0.3 已按下面的"本版做法"改写；不同意的，改回对应段落并在这里划掉。

| 问题 | 本版做法 | 影响 |
|----|----|----|
| Tier 0 前缀要带值才能让 ACME 报 42 码，和"只发握手（字段名）"的硬规则冲突 | 允许带该类别 auto 字段值，purpose 字段永不带值，写回执；AGENTS.md 硬规则同步加例外 | A15、接入阶梯 |
| `packages/sdk`、`packages/cli` 原归 A 线，但 T2 让 Codex 写 | 归 B 线；A 线只冻结契约 | AGENTS.md 目录表 |
| session ID 按 agentId 推导，重置或重新注册后回头客就断 | 按 `merchantKey = domain ?? agentId` 推导 | session.ts、A22 |
| pharmacy / hotel 已砍，契约里还在 | 从类型和策略表删除 | types.ts、policy.ts |
| `docs/superpowers/` 被 gitignore，计划却引用其中的设计文档 | 本文摘要为准；要给 agent 看就移出 ignore | C 线 |
| 本文件改动与"以 Artifact 为准"冲突 | 人把 v0.3 回写 Artifact 后，再按 Artifact 重新导出 | 全部 |
| 模型 ID `claude-sonnet-5-5` 未在本仓库验证 | 预检里实际调一次 | A、B |

## 8 · 更大的图景（赛后）

这一节不改变 24 小时的范围，任何一条都不进 P0。它回答评委和我们自己的同一个问题：如果这个周末成立，它会长成什么。下文的数字都是**目标**，不是数据，不能出现在页面或台词里当成果。

### 北极星

网页有了 cookie，才有登录、购物车、个性化，电商才长得出来。agent 互联网有传输（MCP、A2A），有商务（UCP），有支付（Visa Trusted Agent Protocol），唯独缺一层：**这是谁、能给什么、给了谁、什么时候失效**。每家平台都在自建 memory，结果用户被锁在一家，商家每次都冷启动。

Agent Cookie 要成为这一层：**cookie 的便利 + OAuth 的授权 + 支付网络的追责，由用户持有，按 pairwise 设计成拼不起来。**

### 为什么是现在

- **标准正在同时成形。**MCP 的 `_meta`、A2A 的 metadata、UCP 的 checkout、Visa TAP 都留了位置，但没有一个定义"用户身份与同意"。窗口期就是现在，晚一年就是某家平台的私有格式。
- **监管要的正是这套原语。**GDPR 的数据最小化和目的限制、CCPA 的知情权，都直接对应按用途放行、pairwise ID、回执。合规团队会成为我们的销售。
- **商家的痛是真的。**agent 流量没有 cookie，没法认回头客，没法风控，也没法追责。Tier 0 让商家什么都不装就能受益。

### 四个阶段

| 阶段 | 时间 | 交付 | 成功的样子（目标） |
|----|----|----|----|
| 1 · 演示 | 本周末 | 单机工作台、一个用户、两家真实店、iMessage | P0 全绿，demo 两遍无人工干预 |
| 2 · 开放协议 v1 | 赛后 30 天 | 规范文档（握手、字段词表、策略语义、错误码、`_meta["agent-cookie"]` 绑定）；参考实现开源；npm / PyPI SDK；`/add-agent-cookie` 公开发布；验收清单改写成一致性测试套件 | 10 个外部商家 agent 接入；1 个个人 agent 产品默认带挂钩 |
| 3 · 托管 jar + 联邦 | 6 个月 | 自托管和托管 jar 并存；WebFinger 与手机号哈希目录做入站发现；jar 之间互通；`/.well-known/oauth-authorization-server`，标准 OAuth 客户端零配置；握手签名成为默认 | 10 万个用户 jar；任何 MCP 客户端一行配置接入 |
| 4 · 标准 | 18–24 个月 | MCP 规范扩展提案；IETF / OpenID Foundation 草案（pairwise subject + 按用途授权 + 回执）；与 UCP、Visa TAP、Mastercard Agent Pay 的映射文档 | 成为 agent 商务里默认的身份与同意层，我们是参考实现之一而不是唯一实现 |

### 让它成为协议，而不是产品

- **字段词表开放治理**，像 schema.org：标准字段加命名空间扩展（`x-shoe:width`），新增字段走公开提案。
- **策略可机器验证。**POLICY.yaml 是声明式的，`canRead` 的结果可以离线复算；商家和审计方不用信任我们的服务器，只用跑同一份规则。
- **一致性测试套件。**A01–A22 本来就只打 HTTP，改写成协议一致性测试，任何实现都能跑（对标 OAuth conformance、Web Platform Tests）。"通过一致性测试"就是兼容标志。
- **验签代替信任。**D 线的 jar 签名 + JWKS 让商家只需验签，不需要信任任何一家托管方。这是能联邦的前提。

### 网络效应

- **双边飞轮。**每多一家接入的商家，用户卡上的 observed 来源就多一个，卡更准；卡越准，商家接入的价值越大。
- **冷启动不需要任何人点头。**Tier 0 是一段文本前缀，商家不改代码就开始受益；Tier 2 由 coding agent 一条命令完成。cookie 当年铺开靠的就是"服务端不配合也能用"。
- **可携带是核心卖点。**换个人 agent 不丢任何东西（A22）。封闭平台不会喜欢，所以先拿开源 agent、中小平台和商家侧。

### 不止购物：同一套原语

| 场景 | 敏感字段 | 按用途 | 为什么需要拼不起来 |
|----|----|----|----|
| 出行与酒店 | 护照号、会员号 | 仅 `check_in` | 航司和酒店不该合并出你的行程 |
| 医疗与药房 | 过敏、用药 | 仅 `prescription` | 药房和雇主的数据库绝不能对上同一个人 |
| 身份核验（KYC） | 证件 | 只给"已核验"断言，不给证件（可验证凭证、SD-JWT） | 一次核验，处处复用，不复制证件 |
| 工作交接（队友方案） | 任务上下文 | 仅接手的 agent，带过期 | 交接完就失效 |
| agent 信誉与风控 | 该 session 的成交与被拒历史 | 仅该商家 | 商家能风控，但拿不到跨站画像 |

### 商业模式（假设，待验证）

- **协议和参考实现永远免费、开源。**这是成为标准的门票。
- **托管 jar：**个人免费；Pro 订阅（多设备、家庭共享、长期回执与导出）。
- **商家侧按放行收费：**只对按用途放行的敏感读取和验签登录计费，像支付网络按交易收费；auto 字段永远免费，免得把基础层做成收费站。
- **合规服务：**给企业 agent 的回执审计导出、DPA 模板、数据最小化报告。
- **写进规范的红线：**不卖数据，不做广告，不提供第三方 cookie。信任是唯一的护城河。

### 规模化以后的风险

| 风险 | 对策 |
|----|----|
| 大平台各做封闭版本 | 先成标准、先拿商家侧；Tier 0 不需要平台配合；一致性测试让"兼容"可以被验证 |
| 鸡生蛋：没商家就没用户，反之亦然 | Tier 0 零接入 + coding agent 一条命令接入，把商家成本压到接近零；先在一个垂直（鞋、运动）做密 |
| 托管 jar 成为蜜罐 | 用户持钥、静态加密、自托管是一等公民；托管方看不到值 |
| 放行出错的责任 | 每次放行有签名回执；策略可复算；与支付网络和保险方合作定义责任边界 |
| 字段词表碎片化 | 公开治理 + 命名空间扩展；核心字段少而稳 |

### 答辩里怎么讲大

- 先演真的，再讲大的。演示部分只说实现了的能力（演示规则不变），收尾一句明确标成"下一步"。
- 三句话版本：**网页有 cookie 才有电商；agent 之间还没有。我们做了第一张，它让对方认识你而拿不到你。下一步把它开放成协议，用户持有，谁都能实现。**
- 评委问"为什么不是 OpenAI / Google 来做"：因为这一层必须是中立的、可携带的；平台做的只能是平台内的 memory，不会让你带着它去找它的竞争对手。
