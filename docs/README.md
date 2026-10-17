# Agent Cookie · 运行入口

Agent Cookie 让陌生 agent 在首条消息前获得按策略放行的用户上下文，并用商家独立的 session 与 note 保持回头客关系。身份卡由确定性规则合并；用户能查看来源、撤销授权并核对活动。

当前交付在 `lane-c`，由人合入 main。已完成 Sample 控制台、fixtures 检查及原版 commerce-agents bootstrap；rules/memory 包测试须安装正式 contract 依赖。A 的正式 contract/workspace 已随 main 798e0de 合入；B 的 SDK 仍待合入和 workspace 接线。完整 Photon、真实 UCP 和深度商家接入不能视为已交付。验收现状见 [C14 证据](evidence/C14-http-acceptance.md)，逐项进度见 [C 线队列](lane-c-queue.md)。

## Agent 与演示数据

| 名称 | 身份与用途 |
| --- | --- |
| Sample · Photon personal agent | `sample-personal-photon`，个人 agent，贡献初始 lang/tone/shoe_size |
| Sample · Claude Desktop personal agent | `sample-personal-desktop`，第二个个人 agent，用于换入口后的身份连续性 |
| Sample · ACME shoe agent | `sample-acme`，`shoe` 类别注册，Tier 0 chatEndpoint 为 `http://127.0.0.1:8000/api/chat` |
| Sample Storefront A / B | 两份固定上游 `ShoppingAgent`，通用 Sample 商品，独立进程；尚未连接工作台 memory |
| UCP 商家代理 | 工作台按真实 seller domain 建立代理；C 历史实录为 Reebok 与 Marathon Sports；D 新增 Marathon / Black Flag 的 EU42 pin pair，尚待接入工作台 |

上游为 Anthropic [commerce-agents 固定版本](https://github.com/anthropics/commerce-agents/tree/fd4d59224ab96b43c6dc6888207c67b3bd5a24cf)。它提供现成店面和真实 memory 接缝，适合做接入示例。用户已选择保留通用商品；它不会为原 A15 的“42 码鞋报价”自动提供证据。

## 启动与检查

使用 Node **22.12+，仍在 22 系列**、pnpm；本轮验证版本为 Node 22.23.3，blueprint 使用 Python 3.11+。依赖与第三方克隆不要提交。

控制台的依赖安装、SDK 接线与服务端 `AGENT_COOKIE_KEY` 配置以 [控制台 README](../apps/console/README.md) 为准。准备完成后，从仓库根目录执行：

```sh
pnpm --dir apps/console dev
# http://127.0.0.1:5173；Sample 模式不需要工作台钥匙。

# 另一个终端：
pnpm --dir apps/console test
pnpm --dir apps/console typecheck
pnpm --dir apps/console build
node fixtures/verify.mjs
node fixtures/ucp/verify.mjs

# 原版 blueprint；外部克隆与依赖默认位于 /tmp。
bash examples/blueprint/setup.sh
bash examples/blueprint/run.sh
# 保持上面的启动器运行，在另一终端核验：
python3.11 examples/blueprint/verify.py
```

双店启动、四个独立端口和隔离环境文件见 [dual/USAGE.md](../examples/blueprint/dual/USAGE.md)。没有模型凭据时，health/catalog/session 可以检查，真实聊天不会成功；不能把 HTTP 200 的 SSE error 当成回复。

A 的 `packages/contract` / `apps/workspace` 已合入；以下需根配置负责人把 C 新包纳入依赖锁后执行：

```sh
pnpm install
pnpm --filter @agent-cookie/rules test
pnpm --filter @agent-cookie/rules typecheck
pnpm --filter @agent-cookie/memory-repo test
pnpm --filter @agent-cookie/memory-repo typecheck

AGENT_COOKIE_DEMO=1 AGENT_COOKIE_UCP=fixture pnpm --filter @agent-cookie/workspace start
```

工作台必须明确装载真实 rules/memory/UCP adapters；A `bd9d6e3` 默认仍使用桩。C10b 已让控制台服务端从 `AGENT_COOKIE_KEY` 读取 owner key，通过 SDK 连接本机 4310；缺失方法暂用标注 `TODO(sdk)` 的 HTTP 调用。实际 SDK 读取、撤销和 reset 已在隔离 Sample 后台验证，见 [C10b 证据](evidence/C10b-sdk.md)。连接后顶部“重置演示”调用 owner-only `POST /demo/reset`；main 798e0de 的根 `demo:reset` 已带 `AGENT_COOKIE_KEY` Bearer 鉴权，可在同一 owner 环境调用；根 `pnpm dev` 组合启动和 CLI reset 仍须由对应线补齐。C 不改根脚本。

HTTP 验收的隔离 fixtures、无模型 callback、Sample key 绑定和实际命令见 [tests/acceptance/README.md](../tests/acceptance/README.md)。它会重置状态，不能与演示或控制台操作并行。A10/A17 的真实客户端证据另行保存。

UCP CLI 的安装与 agent profile 初始化：

```sh
export OPT_OUT_INSTRUMENTATION=true
npm i -g @shopify/ucp-cli
ucp profile init --name agent
```

录制命令、来源与响应校验见 [UCP fixtures](../fixtures/ucp/README.md)。安装 CLI 本身不会把工作台的 UCP 桩替换成真实 adapter。

## 环境变量

| 名称 | 谁使用 / 设置 |
| --- | --- |
| `AGENT_COOKIE_URL` | SDK/CLI/MCP/Photon/验收的工作台地址，默认 `http://127.0.0.1:4310` |
| `AGENT_COOKIE_KEY` | 当前调用者的钥匙，放 host 环境；C10b 控制台服务端使用 owner key，不加 `VITE_` 前缀、不打进浏览器 bundle |
| `AGENT_COOKIE_DEMO` | 工作台设 `1` 才开放演示 reset 和 Sample dev keys |
| `AGENT_COOKIE_TEST` | 仅验收工作台设 `1`，开放 `/test/clock`；普通演示不需要 |
| `AGENT_COOKIE_UCP` | `fixture` 读取实录、`live` 请求真实商家；先确认实际 adapter 已接通 |
| `MEMORY_REPO_PATH` | 工作台管理的专用用户记忆目录；不要指向开发仓库或其他用户文件 |
| `FIXTURES_DIR` | A 工作台的 seed 根目录，含 users/agents/contributions/dev-keys/memory/ucp |
| `AGENT_COOKIE_DATA_DIR` | A 工作台独立运行数据目录；验收用临时专用目录 |
| `SQLITE_PATH` | A 工作台 SQLite 文件覆盖项；客户端和验收不直接访问 |
| `PORT` | A 工作台端口，演示保持 4310，host 固定 127.0.0.1 |
| `UCP_BIN` | UCP CLI executable，可用隔离安装路径 |
| `OPT_OUT_INSTRUMENTATION` | UCP 子进程统一设 `true` |
| `ANTHROPIC_API_KEY` | 真实模型聊天，由人提供；双店分别经仓库外环境文件加载 |
| `BLUEPRINT_DIR` / `BLUEPRINT_PYTHON` | 单店脚本的外部克隆与 Python executable 覆盖项 |
| `AGENT_COOKIE_SAMPLE` | B SDK/通道/控制台服务显式标记 Sample 数据，`1`/`0`；不是工作台授权开关 |
| `AGENT_COOKIE_SDK_ROOT` | SDK 尚未合入时，可指向仓库外已构建 B 包的运行根；合入并完成 workspace 链接后无需设置 |
| `AGENT_COOKIE_JAR_KEK` / `AGENT_COOKIE_UNLOCK_SECRET` | D 线 jar/passkey 接线所需；当前不作为已验证 P0 前提 |
| `STRIPE_SECRET_KEY` | D 线测试支付凭据，由人提供；本轮没有执行付款 |
| `SENTRY_DSN` | P1 tracing 配置；未设置不等于验收通过 |
| Photon 凭据 | 由 B 线按真实 Photon 接入文档配置，本文不编造名字 |

端口：工作台 4310、控制台 5173、MCP 计划为 4311；原版单店 API/UI 8000/3000，双店第二份 8001/3001；D 的 unlock 计划为 4312。只有实际启动和验证过的组件才视为可用。

## 证据和重放

[UCP 实录](../fixtures/ucp/README.md) 包含真实 catalog、两家 discover 和一次 cart create，未付款；库存只代表录制时。`fixtures/memory/CARD.md` 是生成物，由 rules 的 seed 生成脚本产生，不能手改。

[证据索引](evidence/README.md) 区分包测试、Sample UI、工作台 HTTP、真实模型和手动客户端录屏。只有全部 P0（A01–A12、A17、A18、A22）满足才算可演示。备用视频必须记录真实执行并标注 `Recorded run`；当前没有可据此宣布完整 Recorded run 通过的材料。
