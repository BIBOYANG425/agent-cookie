# Agent Cookie — Devpost draft

Draft updated 2026-10-17. English is the primary submission copy; a complete Chinese version follows. The demo video is still a draft: continuous iMessage footage and clean phone-learning/quote-ranking evidence remain to be collected. Completion status follows the [evidence index](evidence/README.md), with setup and architecture in the [project README](../README.md).

## English

### Project title

**Agent Cookie**

### One-line description

Let the next agent know you before its first reply, with context you can inspect and revoke.

### Inspiration

Website cookies let a site remember a session, a preference, or a previous visit. Moving between personal assistants and merchant agents often means repeating those details. We wanted continuity with visible boundaries: which merchant receives context, why a field is released, and when access ends.

### What it does

Agent Cookie has three objects: an **identity card** built from agents' structured contributions; a **conversation cookie** with a separate session and note per merchant; and a **workspace** that matches agents, enforces field policies, expires grants, and records purpose-scoped reads.

A shopping request in iMessage can return offers from at most two merchants. The user's explicit conditions take priority. Only the accepted merchant may read an address for checkout. Unknown delivery dates, sizing warnings, no matches, and failures remain visible. A handoff link is not a completed payment.

The console shows provenance, learned candidates, request conditions, grants, and receipts. Users can pause learning or revoke access; already-delivered information cannot be recalled. [Console evidence](evidence/console/README.md)

### How we built it

**TypeScript, Hono, SQLite, and Git** power the local workspace. A shared contract connects the SDK, CLI, personal MCP server, **Photon Beta iMessage**, and **Vite/React** console. Authorization, merging, and expiration are deterministic code; models cannot approve access.

The memory repository follows Agent Memory Repo's `MEMORY.md` index, `[[links]]`, and line-based metadata. The workspace manages four paths while other files remain available to the user's agents. **A23 passed with the unchanged Cognition stock skill**, independent-session readback, workspace writes, and scoped reset. [A23 evidence](evidence/cognition-skill-interop.md)

**Shopify UCP CLI** supplies catalog/cart/checkout operations; fixtures preserve captured responses. Our pairwise merchant identifiers stay inside the workspace’s UCP proxies. Opt-in learning uses local filtering → **typesafe/jev-1.14** → **openai/gpt-oss-120b through OpenRouter**, followed by schema checks and merge rules. Raw observations wait only in bounded memory; persisted evidence snippets are limited to 200 characters. Independent conversations or intents support preference promotion. [Model evidence](evidence/2026-10-17-learning-live.md)

### Challenges we ran into

- **Live UCP inventory:** recorded results cannot prove current availability. We preserve capture provenance and distinguish fixture replay, no matches, and handoffs. [Recordings](../fixtures/ucp/README.md)
- **OpenRouter account limits:** an early Haiku request returned 403. The subsequently approved open-weight pipeline passed the six scenarios without weakening validation or provider privacy requirements. [Initial restriction](evidence/2026-10-17-openrouter-live.md) · [Later success](evidence/2026-10-17-learning-live.md)
- **Tier 0 protocol:** ACME required its own session/header protocol. We retired A15 from the demo. Separate Claude Code and Devin integration runs passed A16; the full note lifecycle remains blocked. [A15](evidence/A15/README.md) · [A16](evidence/A16/README.md)
- **SQLite concurrency:** learning, regeneration, and forgetting can overlap. Serialized mutations, SQLite transactions, and recoverable Git projections prevent late results from restoring removed current state. Old Git history remains; the stores have separate transaction boundaries. [Recovery evidence](evidence/2026-10-17-b49-repair.md)

### What we learned

Memory needs a lifecycle: provenance, expiry, revocation, and recovery. Two records from one conversation are still one source. Real compatibility testing also matters—A23 exercised the original skill and workspace in the same repository.

### What's next

Collect a clean natural phone-learning run, compare quote ranking against the same candidate set, and finish continuous footage and UCP failure recordings. Then connect merchant **needs declarations**, harden **callbacks/webhooks**, verify mobile **passkeys**, and complete separately authorized **payment** integration.

### Verification and submission materials

| Area | Current scope |
| --- | --- |
| Learning | Real models passed 6/6 original scenarios with synthetic inputs and isolated SQLite/Git; commerce was fixture-backed. Clean positive phone learning plus ranking remains pending. |
| Clients / integration | Real iMessage and Desktop records; A16 Claude Code + Devin passed under the October 17 closeout decision; A23 passed. Continuous phone footage remains pending. |
| Commerce | Handoff evidence, no completed real-payment claim; some failure recordings remain missing. |

[Code](https://github.com/BIBOYANG425/agent-cookie) is currently private; reviewer access must be arranged. Video is **draft / pending reviewed recording**; see the [storyboard](video-storyboard.md) and [evidence index](evidence/README.md). Third-party blueprint, UCP recordings, and stock skill are credited there. Sample, fixture, Recorded run, and live results remain distinct. We store no card numbers.

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

代码：[BIBOYANG425/agent-cookie](https://github.com/BIBOYANG425/agent-cookie)（当前私有，需安排评审访问）。视频：**草稿，待完成并审阅录屏**，制作安排见[分镜](video-storyboard.md)。准备提交 Applied Intelligence、Photon、Visa、Cognition、Paper、Sentry 赛道，各项实际范围见 [README](../README.zh.md#赛道与提交材料)；不宣称获奖或已获资格确认。

第三方材料包括 A16 使用的仓库外 Anthropic commerce-agents blueprint、采集的 Shopify UCP 响应，以及未修改的 Agent Memory Repo stock skill。Sample、fixture 回放、Recorded run 和现场实时结果须清楚区分。项目不存卡号，不替用户完成付款。
