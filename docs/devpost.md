# Agent Cookie — Devpost draft

Draft updated 2026-10-17. English is the primary submission copy; a complete Chinese version follows. The demo video is still a draft: continuous iMessage footage and clean phone-learning/quote-ranking evidence remain to be collected. Completion status follows the [evidence index](evidence/README.md), with setup and architecture in the [project README](../README.md).

## English

### Project title

**Agent Cookie**

### One-line description

Let the next agent know you before its first reply, with context you can inspect and revoke.

### Inspiration

Website cookies make small moments of continuity possible: a site can remember a session, a preference, or a previous visit. When we move between personal assistants and merchant agents, we often repeat the same details. A size, a style preference, and the context of the last interaction can disappear at the boundary between systems.

We wanted that continuity to be understandable to the person it describes. Each merchant should receive the context its task permits. The user should be able to see where a preference came from, why a field was released, and when access ends. Agent Cookie is our attempt to build that missing layer.

### What it does

Agent Cookie has three objects:

- **An identity card.** Agents contribute structured facts with provenance. Deterministic rules merge eligible contributions, keep weaker evidence as candidates, and let old information decay. Learned preferences use independent conversations or intents as evidence sources; repeating a statement within one conversation does not create a second source.
- **A conversation cookie.** Each merchant relationship has a separate session identifier and a merchant-specific note. The same user can change personal assistants while keeping the same relationship with that merchant. UCP storefront identifiers stay inside our workspace's merchant proxies rather than being sent to those stores as a new tracking identifier.
- **A workspace.** It registers and matches agents, checks field policies and purpose, expires or revokes grants, and records purpose-scoped reads. The React console makes the card, learned entries, request-specific conditions, grants, receipts, and activity visible.

The shopping flow starts with a user's own request in iMessage. The workspace applies the request's explicit conditions and relevant card context, returns offers from at most two merchants, and provides a handoff link after the user selects an offer. An address is available only to the accepted merchant for checkout. The interface preserves unknown delivery dates, sizing warnings, no matches, and failures. A handoff link does not establish that payment or an order completed.

The console also shows the models behind a learned contribution, its evidence source, and candidate/on-card status. Users can pause learning or revoke a contribution. Revocation stops subsequent authorized reads; it cannot retrieve information a recipient has already received. [Console evidence](evidence/console/README.md)

### How we built it

The workspace runs locally with **TypeScript, Hono, SQLite, and a Git memory repository**. Shared types and field policies define the contract across the SDK, CLI, personal MCP server, Photon channel, and console. Authorization, source counting, expiration, and card generation are deterministic code. Model output cannot grant itself access.

The memory repository uses Agent Memory Repo's short `MEMORY.md` entry point, `## Index`, root-relative `[[links]]`, and one-record-per-line metadata. The workspace owns `CARD.md`, `contributions/`, `notes/`, and `receipts.md`; other files remain available for ordinary agent notes. In A23, Cognition's unmodified stock skill saved and committed a preference, a new session read it back, and the workspace continued contributing and writing receipts to the same repository. A scoped reset preserved the skill's files. [A23 interoperability](evidence/cognition-skill-interop.md)

**Shopify UCP CLI** supplies catalog, cart, and checkout operations. Live mode queries merchants; fixture mode replays captured responses with explicit labels. **Photon Beta iMessage** carries the user's request and reply. **Claude Desktop** connects through the personal MCP server. The **Vite/React** console reads through a local SDK bridge, keeping its owner credential on the server. [Real channel checks](evidence/2026-10-17-real-adapters-verification.md) · [Desktop evidence](evidence/A10-real-client.md)

Opt-in learning runs local filtering, then the **`typesafe/jev-1.14` gate**, then **`openai/gpt-oss-120b` extraction through OpenRouter**. Structured output is checked against the preference whitelist before the workspace applies its merge rules. Raw observations wait in a bounded memory queue; persisted contributions contain structured values and evidence snippets of at most 200 characters, rather than conversation transcripts. The console displays model provenance. Real model calls passed all six original learning scenarios using synthetic inputs, temporary SQLite/Git state, and fixture commerce. [Model verification](evidence/2026-10-17-learning-live.md) · [Updated gate verification](evidence/2026-10-17-gate-redesign.md)

### Challenges we ran into

- **UCP inventory changes.** A recorded catalog is reproducible, but it cannot establish that an item is in stock now or that a new query has a match. We kept capture provenance and Sample/fixture labels, and treated unavailable items, uncertain sizing, and merchant handoffs as distinct outcomes. [UCP recordings](../fixtures/ucp/README.md)
- **OpenRouter account restrictions.** Our early Haiku attempt returned HTTP 403 despite a publicly listed eligible endpoint. Account access and endpoint availability were separate constraints. We subsequently moved to the approved open-weight pipeline and completed the real-model six-scenario run while retaining strict validation and provider privacy requirements. [Initial restriction](evidence/2026-10-17-openrouter-live.md) · [Successful later run](evidence/2026-10-17-learning-live.md)
- **Tier 0 protocol compatibility.** The original ACME retail blueprint required its own session/header protocol; our generic text-prefix delivery did not produce a working conversation. We retired A15 from the demo on October 17. Separate skill-guided integration exercises with Claude Code and Devin are complete under A16; the full note lifecycle remains a P1 dependency. [A15 history](evidence/A15/README.md) · [A16 runs](evidence/A16/README.md)
- **SQLite concurrency and Git consistency.** Learning, card regeneration, and forgetting can overlap. We serialized card mutations, used SQLite transactions, and made failed Git projection work recoverable. A pending forget keeps learning paused, and late model results cannot restore the removed current state. SQLite and Git still have separate transaction boundaries; old Git history is retained. [Repair and recovery evidence](evidence/2026-10-17-b49-repair.md)

### What we learned

Memory needs a lifecycle. Source identity, expiry, revocation, and recovery determine whether remembered context remains trustworthy. Counting evidence by the right unit matters: two records from one conversation are still one source.

Compatibility also needs an actual trial. A23 tested the original skill against the same repository the workspace uses. Separating model verification, real-channel evidence, and recorded commerce kept us from treating one successful layer as proof of the whole product.

### What's next

Finish the clean natural phone-learning run and compare quote ranking using the same candidate set. Complete continuous demo footage and missing real UCP failure recordings. Then connect merchant **needs declarations** to the console, harden external callbacks/webhooks and retry behavior, verify the **passkey** flow on a real phone, and complete separately authorized **payment** integration. These are planned work, not claims of a finished payment service.

### Verification and submission materials

| Area | Current evidence |
| --- | --- |
| Learning | Six original scenarios pass with real models and synthetic inputs; a clean positive phone-learning run plus quote-ranking evidence is still pending. |
| iMessage / Desktop | Real channel and Desktop records exist; continuous iMessage footage remains pending. |
| Coding-agent integration | A16 passed with Claude Code and Devin under the October 17 closeout decision; full note lifecycle C11 remains blocked. |
| Stock memory skill | A23 passed: unchanged skill, independent-session readback, same-repo workspace writes, scoped reset. |
| Commerce / payment | Captured merchant responses and handoff evidence; no completed real payment claim. Some real failure-path recordings remain missing. |

Code: [BIBOYANG425/agent-cookie](https://github.com/BIBOYANG425/agent-cookie) (currently private; reviewer access must be arranged). Video: **draft / pending reviewed recording**, with the [storyboard](video-storyboard.md) as the production plan. Intended submission tracks are Applied Intelligence, Photon, Visa, Cognition, Paper, and Sentry; the [README](../README.md#赛道与提交材料) records each track's actual scope. These are submission plans, not eligibility or award claims.

Third-party materials include the external Anthropic commerce-agents blueprint used for A16, captured Shopify UCP responses, and the unmodified Agent Memory Repo stock skill. Sample data, fixture replay, Recorded run footage, and live results must remain visibly distinguished. The project does not store card numbers or complete payment for the user.

## 中文

### 项目标题

**Agent Cookie**

### 一句话

让下一个 agent 在第一条回复前认识你，并让这些上下文有来源、可查看、可撤销。

### 灵感

网站 cookie 让很多小事能够延续：登录状态、偏好、上一次访问。换到个人助手和商家 agent 之间，我们却经常重新解释自己的尺码、喜好和上次交流的背景。这些信息容易停留在某个系统内部。

我们希望这种连续性由用户看得懂的规则管理。每家商家只得到当前任务允许的上下文；用户能知道偏好从哪里来、字段为什么被放行、权限什么时候结束。Agent Cookie 为这层关系提供基础设施。

### 它做什么

Agent Cookie 有三个对象：

- **身份卡**：agent 提交带来源的结构化贡献，由确定性规则合并。证据不足的保留为候选，过时信息会衰减。学习偏好按不同对话或意图计数，同一对话重复两次仍只算一个来源。
- **对话 cookie**：每家商家有独立 session ID 和本商家的 note。同一个用户换个人助手后，与同店的关系仍可延续。UCP 店面的这类标识由工作台内部代理持有，不额外发给店面做追踪。
- **工作台**：注册、匹配 agent，核对字段策略、用途、有效期与撤销，记录按用途读取的回执。控制台展示身份卡、学到的条目、本次请求条件、授权、回执和活动。

购物从 iMessage 里的一句真实需求开始。工作台结合本次明确条件和适用的卡片信息，返回至多两家商家的报价；用户选择后得到商家的继续处理链接。地址只在 accept 后按 checkout 用途给被选中的一家。未知到货时间、尺码提示、没有匹配和失败都会如实显示；交接链接不代表付款或下单完成。

“学到的”视图展示候选或已上卡状态、证据来源和模型链。用户能暂停学习、撤销贡献。撤销会阻止后续获准读取，无法收回对方已经收到的信息。[控制台证据](evidence/console/README.md)

### 怎么做的

工作台使用 **TypeScript、Hono、SQLite 和 Git 记忆库**，在本机运行。共享契约定义字段、策略与接口，SDK、CLI、个人 MCP 服务、Photon 通道和控制台按同一契约交互。授权、来源计数、过期和身份卡生成均为确定性代码，模型不能给自己批准权限。

记忆库兼容 Agent Memory Repo 的短 `MEMORY.md` 入口、`## Index`、根相对 `[[链接]]` 和一行一条元数据。工作台托管 `CARD.md`、`contributions/`、`notes/`、`receipts.md`，其他文件可用于普通 agent 记事。A23 用未修改的 Cognition stock skill 保存并提交偏好，新会话读回，再由工作台在同一库里写贡献和回执；限定重置后 skill 文件仍保留。[A23 互操作](evidence/cognition-skill-interop.md)

**Shopify UCP CLI** 处理目录、购物车和 checkout；live 模式访问商家，fixture 模式明确标注录制回放。**Photon Beta iMessage** 承载真实消息，**Claude Desktop** 通过个人 MCP 接入。**Vite/React** 控制台通过本地 SDK 桥读取，owner key 留在服务端。[真实通道检查](evidence/2026-10-17-real-adapters-verification.md) · [Desktop 证据](evidence/A10-real-client.md)

学习显式启用后，先本地过滤，再由 **`typesafe/jev-1.14`** 门控，经 OpenRouter 调用 **`openai/gpt-oss-120b`** 提取，最后校验白名单并按规则合并。原始观察只在有界内存队列等待，持久化的是结构化贡献及最多200字的证据摘句，不保存整段对话原文。控制台显示模型来源。真实模型已通过原样六场景，输入是合成文本，SQLite/Git 是隔离的真实实现，商家为 fixture。[模型验证](evidence/2026-10-17-learning-live.md) · [新 gate 验证](evidence/2026-10-17-gate-redesign.md)

### 挑战

- **UCP 实时库存**：录制可以复现一次响应，却无法证明商品现在有货或新需求一定匹配。我们保留采集来源、Sample/fixture 标签，并区分无匹配、尺码未知和商家交接。[UCP 录制](../fixtures/ucp/README.md)
- **OpenRouter 账户限制**：早期 Haiku 尝试返回 HTTP 403，公开端点存在并不等于当前账户可用。后续改用获准的开放权重模型链，在保留严格校验及 provider 隐私要求的前提下完成真实模型六场景。[历史限制](evidence/2026-10-17-openrouter-live.md) · [后续通过](evidence/2026-10-17-learning-live.md)
- **Tier 0 协议**：原版 ACME retail 需要自己的 session/header 协议，通用文本前缀没有带来可用对话。10月17日决定将 A15 从演示移除。Claude Code 与 Devin 的独立 skill 接入实跑另按 A16 收口通过；完整 note 生命周期仍是 P1 依赖。[A15 历史](evidence/A15/README.md) · [A16 实跑](evidence/A16/README.md)
- **SQLite 并发与 Git 一致性**：学习、重生成和忘记可能同时发生。我们串行化卡片修改，使用 SQLite 事务，并让失败的 Git 投影可以恢复。忘记尚未完成时保持暂停，迟到模型结果不能恢复已移除的当前状态。SQLite 和 Git 仍有各自的事务边界，旧 Git 历史会保留。[修复与恢复](evidence/2026-10-17-b49-repair.md)

### 学到的

记忆需要完整生命周期。来源身份、过期、撤销和失败恢复决定了记住的信息是否可信；同一对话的两条记录不能冒充两个独立来源。

格式兼容也要实际试跑。A23 让原版 skill 与工作台共用同一个记忆库。把真实模型、真实通道和录制商家三层证据分开，帮助我们明确每次成功究竟证明了什么。

### 下一步

补完干净的手机自然学习正向流程，在相同候选集下核对报价排序；完成连续演示原片及缺失的真实 UCP 失败录制。随后接上商家 **needs 声明**、加强外部 callback/webhook 和重试处理、验证真实手机 **passkey**，并完成另行授权的 **支付** 接入。这些是计划，不代表已完成真实支付服务。

### 验证与提交材料

| 范围 | 当前证据 |
| --- | --- |
| 学习 | 真实模型、合成输入原样六场景通过；干净手机正向学习和报价排序仍待补。 |
| iMessage / Desktop | 已有真实通道与 Desktop 材料；连续 iMessage 原片待补。 |
| coding agent 接入 | A16 按10月17日收口裁决通过 Claude Code + Devin；完整 note 生命周期 C11 仍阻塞。 |
| stock 记忆 skill | A23 通过：未修改 skill、新会话读回、同库工作台写入与限定重置。 |
| 商家与支付 | 有真实商家响应录制和 handoff 证据；没有真实付款完成声明，部分失败录制仍缺。 |

代码：[BIBOYANG425/agent-cookie](https://github.com/BIBOYANG425/agent-cookie)（当前私有，需安排评审访问）。视频：**草稿，待完成并审阅录屏**，制作安排见[分镜](video-storyboard.md)。准备提交 Applied Intelligence、Photon、Visa、Cognition、Paper、Sentry 赛道，各项实际范围见 [README](../README.md#赛道与提交材料)；不宣称获奖或已获资格确认。

第三方材料包括 A16 使用的仓库外 Anthropic commerce-agents blueprint、采集的 Shopify UCP 响应，以及未修改的 Agent Memory Repo stock skill。Sample、fixture 回放、Recorded run 和现场实时结果须清楚区分。项目不存卡号，不替用户完成付款。
