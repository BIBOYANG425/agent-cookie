# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

同一份内容也在 AGENTS.md。Claude Code 读这份，Codex 读那份。

## 项目一句话

让陌生 agent 在第一条消息之前就认识用户的一层基础设施：身份卡（agent 写、后台合并）、对话 cookie（每个商家一个 pairwise session ID 和自己的 note）、工作台（注册、匹配、按用途放行、过期、撤销、回执）。

## 真相来源

- 工程计划：`docs/plan.md`（导出自共享 Artifact，以 Artifact 为准）。契约（类型、字段策略、HTTP 端点、MCP 工具、错误码）在其第 5 节，冻结后落在 `packages/core/src/types.ts` 与 `policy.ts`。改契约要两条线以上同意。
- demo 设计：`docs/plan.md` 第 3 节。
- 不要发明新的字段名、端点名、工具名。缺什么先在契约里加，再实现。

## 四条线，按目录分家

| 线 | 拥有的目录（只改这些） |
|---|---|
| A · 核心与工作台（Claude Code，Bo 的会话） | `packages/core` `apps/workspace` |
| B · 通道与个人 agent（Codex A，Cyrus 的） | `packages/sdk` `packages/cli` `packages/mcp` `apps/channel-photon` `skills/agent-cookie` |
| C · 演示面与验收（Codex B，Bo 的） | `apps/console` `examples/blueprint` `skills/add-agent-cookie` `fixtures` `tests/acceptance` `docs` |
| D · 登录与支付（Devin，Bo 的，P1） | `packages/auth` `packages/pay` `apps/unlock` |

规则：
- 只改自己线的目录。需要别的目录改动，写进 `docs/requests.md` 一行，由人转达（这个文件所有线都可以追加，只追加不改）。`docs/plan.md` 只有人改。
- 所有线只通过 `packages/sdk` 调工作台；不直接碰 SQLite，不直接碰 git 记忆库。`tests/acceptance` 只打 HTTP。
- D 线对工作台的接口只有 `signHandshake`、`authorizePayment` 两个纯函数和 `POST /personal/unlock` 一个端点，由 A 线在契约里预留。D 线分支在 P0 验收（A01–A12、A17、A18、A22）全绿前不合并进 main。
- 每条线一个分支（`lane-a` / `lane-b` / `lane-c` / `lane-d`），只往自己的目录提交。合并到 `main` 由人做。
- H0–1 只有 A 线写业务代码。B、C 先用 `fixtures/` 和 A 线提供的假工作台开工。

## 硬规则（来自设计，不要绕）

- 字段判断、授权、过期、合并全部用确定性代码；模型只归类文本和生成对话。
- 模型传来的 userId / agentId / purpose 只是参数，不是授权依据。
- 商家永远不碰 git 记忆库；`CARD.md` 只生成不编辑。
- 用户不需要对任何读取点头：按用途与策略核对后放行，每次放行写回执。
- 页面和日志不展示编造的指标；示例数据标 Sample；售罄和 `requires_escalation` 要如实告诉用户。
- 不把用户的身份卡贴进发给别的 agent 的消息里；只发握手（字段名）。唯一例外是 Tier 0 文本前缀：只带该类别的 auto 字段值，purpose 字段永不带值，每次投递写回执。
- passkey 不进 cookie，卡号不进任何地方：jar 自己持密钥，用户 passkey 只解锁 jar；`payment_method` 只存支付提供方的 token 引用，按用途、限额、单次放行授权结果。

## 怎么跑

- Node 22，pnpm。`pnpm install`，`pnpm test`（vitest），`pnpm dev` 起工作台 + 控制台 + Photon 线。
- UCP：`npm i -g @shopify/ucp-cli`，`ucp profile init --name agent`，环境变量 `OPT_OUT_INSTRUMENTATION=true`。
- 工作台只监听 127.0.0.1:4310；钥匙放环境变量 `AGENT_COOKIE_KEY`，地址 `AGENT_COOKIE_URL`。
- 演示重置：`pnpm demo:reset` = `agent-cookie reset` = `POST /demo/reset`（清 SQLite，记忆库重置到 fixtures 初始 commit；仅 `AGENT_COOKIE_DEMO=1`）。
- 环境变量和端口的完整列表见 `docs/plan.md` 第 4 节。
