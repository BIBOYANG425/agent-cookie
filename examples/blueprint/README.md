# ACME blueprint：外部克隆与实地核对

此目录只存我们写的启动、核验脚本与记录。第三方代码、依赖、`.env` 和运行数据留在仓库外。上游为 [anthropics/commerce-agents](https://github.com/anthropics/commerce-agents)，固定提交见 `upstream-revision`：`fd4d59224ab96b43c6dc6888207c67b3bd5a24cf`。本文行号均对应该提交。

当前方向已更新为 [一条真实 UCP 链路 + 两个独立 Sample shopping agent](../../docs/two-storefront-demo.md)。两家复用同一接入实现，独立持有工作台凭据、pairwise session 和 notes；现场 coding agent 安装环节后置。下方单店启动记录是原版基线，不能作为双店工作台集成通过的证据。

已完成的独立协议组件与最小接入路径见 [INTEGRATION.md](INTEGRATION.md)。上游 session/SSE transport 已有离线测试；A 的正式契约 `bd9d6e3` 已可读，尚未合入 main。真实授权与 note wiring 尚未完成；完整 HTTP MemoryStore 仍缺删除、generation/CAS 等契约，未计入真实验收。

双实例已有 [启动说明](dual/USAGE.md) 和 [实测记录](dual/RUN-2026-10-17.md)：两边 health、页面、catalog 通过，跨实例聊天 token 被拒绝。当前仍是原版 ACME 页面，Sample A/B 标签只在启动器与说明中；最终演示还需在页面明确标注。此阶段没有工作台 pairwise ID 或 notes，不能算 A08 通过。

上游公司、商品和人物都是 **Sample**。retail catalog 是通用商店，并非真实鞋店；87 个商品中没有 footwear 分类，商品标题中 `shoe` / `sneaker` / `boot` / `sandal` 的匹配数为 0。不要把原版演示描述为真实鞋报价。

## 启动

依照上游 [README](https://github.com/anthropics/commerce-agents/blob/fd4d59224ab96b43c6dc6888207c67b3bd5a24cf/README.md) 使用 Python 3.11+、Node 22。脚本不改全局 runtime、不覆盖现有克隆、不重置已有数据。

```bash
# 在 Agent Cookie 仓库根目录执行；默认克隆到 /tmp。
bash examples/blueprint/setup.sh
bash examples/blueprint/run.sh

# 另一终端：验证 :8000 API、:3000 HTML、catalog、session/header。
python3.11 examples/blueprint/verify.py

# 真正尝试一轮模型聊天；可能消耗 API credits。
python3.11 examples/blueprint/verify.py --chat
```

自定外部目录：`bash examples/blueprint/setup.sh /tmp/acme-clean-run`，随后设 `BLUEPRINT_DIR=/tmp/acme-clean-run` 运行 `run.sh`，核验用 `verify.py --clone /tmp/acme-clean-run`。`BLUEPRINT_PYTHON` 可指定 Python executable。setup 会拒绝仓库内部路径；已有目标必须是该上游、该 commit、干净工作树。

浏览 catalog 无需模型凭据。聊天需 `ANTHROPIC_API_KEY`，放到当前环境，或外部克隆根目录的 `.env`；不要放入本仓库、命令参数、截图或日志。上游还支持其 SDK credential chain，实际可用性须实测。不要用占位 key 假装完成聊天。

上游启动器在端口冲突时会复用已有 ACME API 或移动到下一空闲端口，因此先看启动日志；本目录核验固定检查 `127.0.0.1:8000` 和 `127.0.0.1:3000`。`Ctrl-C` 停止由启动器创建的进程。`--fresh-memory` 会删该外部克隆的演示 memory，默认不启用。

`verify.py` 退出码：`0` 表示所选检查通过；`1` 表示基础核验失败；`2` 表示基础服务可用但模型聊天未完成。HTTP 200 的 SSE 里仍可能只有 `error` 事件，不能按 HTTP 状态当作聊天成功。JSON 不输出会话 token 或 key。这项探针不等于浏览器交互、A15、A16 或录屏验收。

## 真实 chatEndpoint 交接给 A 线

配置候选值是 `http://127.0.0.1:8000/api/chat`，来自 `examples/demo_common/storefront.py:204`。请求必须先建立上游自己的会话：

```http
POST /api/session
Content-Type: application/json

{"user_id":"<工作台已验证的 pairwise session ID>"}
```

上游返回 `{session_id, user_id, name, tier}`。`session_id` 是上游新生成的随机会话凭据，不是 Agent Cookie 的 pairwise ID；不要打印它。然后发送：

```http
POST /api/chat
Content-Type: application/json
X-Session-Id: <上一步返回的 session_id>

{"message":"<已获准的 Tier 0 前缀与用户消息>","page":{"page_type":"home"}}
```

`message` 长度为 1–4000，`page` 可省略。完整 `PageContext` 为 `page_type`（home/search/product/cart/orders/other）、可选 `product_id`、可选 `query`、默认空对象 `extra`，定义于 `shopping-agent/core/shopping_agent/types.py:181`。上游 session 入口接受任意 demo `user_id`，不是生产认证；绑定 pairwise ID 的授权必须由工作台与受信 host 完成，不能相信模型或浏览器自报身份。

响应是 `text/event-stream`。每帧为 `event: <type>` 与 `data: <JSON payload>`，实现见 `commerce-common/commerce_common/streaming.py:164`；`data` 不含包裹的 `type` 字段。需消费完整流，区分 `error` 与 `turn_complete`。直接投递 `{type:"introduce", ...}`、只发送文本 body、或缺少 `X-Session-Id` 均不符合上游协议。A 线需负责建立/保存这个会话映射与流式响应处理；本目录没有新增工作台端点。

本地计划已更新到 v0.3。A 的正式 `packages/contract/src/tier0.ts` 定义 Tier 0 前缀：仅包含该类别策略允许的 auto 字段值，purpose 字段永不带入，并要求由工作台记录放行回执。不能向消息塞入完整身份卡；本目录的 transport 本身不执行授权或生成回执。

## MemoryStore 实地发现

| 位置 | 已核对事实 |
| --- | --- |
| `examples/retail/api/main.py:17` | 导入 `JsonFileMemoryStore` |
| `examples/retail/api/main.py:40` | 注入 `memory_store=JsonFileMemoryStore(DATA_DIR / ".memory-store.json")` |
| `examples/retail/api/main.py:57` | `MemorySeeder` 会在启动时写 demo profile 的 Sample facts |
| `examples/retail/api/main.py:63` | 商家后台另用 `InMemoryMemoryStore`；不是顾客 storefront 的接入点 |
| `commerce-common/commerce_common/memory.py:78` | Protocol 有六个 async 方法，见下方 |
| `commerce-common/commerce_common/memory.py:108` | `check_memory_store` 在启动时拒绝缺方法的实现 |
| `examples/demo_common/storefront.py:99` | host context 把 record 的 `user_id` 和 `session_id` 分开传入 |
| `shopping-agent/core/shopping_agent/executor.py:103` | `memory_subject` 使用 `session.user_id` |
| `shopping-agent/runtime-messages-api/shopping_agent_runtime/orchestrator.py:279` | post-turn 提取写入 `session.user_id`；`:292` 起读取 preferences 与 memory |
| `commerce-common/commerce_common/memory.py:183` | `validate_fact` 保留 fence、写过滤、上限与来源 session tag |
| `commerce-common/commerce_common/memory.py:521` | 提取前后比较 purge generation；可发现模型调用期间的 clear，但检查与写入不是跨进程原子操作 |

六个方法是 `get_facts(subject_id)`、`upsert_facts(subject_id, facts)`、`search_facts(subject_id, query)`、`delete_fact(subject_id, key)`、`clear(subject_id)`、`purge_generation(subject_id)`。`clear` 不只是删 note，还要增加 purge generation。MemoryFact 有 `key`（≤64）、`value`（≤200）、`category`、`updated_at`、`source_session_id`（session tag，不能是原始聊天 token），见 `commerce-common/commerce_common/types.py:34`。

只换 `main.py:40` 并不能完成接入：默认 seed 会尝试向新 store 写 `demo-user`，而工作台只认识受授权的 pairwise session；读取卡字段后还要明确删除/清空对共享卡的语义。不得用本地 memory fallback 绕过工作台拒绝或过期。具体约束见 [接入 skill](../../skills/add-agent-cookie/SKILL.md) 与 [参考实现门槛](../../fixtures/expected/README.md)。

## 验证范围

实地命令与结果存于 [运行记录](RUN-2026-10-17.md)，原记录和时间保持不变。代码检查、服务启动、模型聊天、Tier 0、Tier 2、干净克隆 skill 运行与录屏是不同证据；只有实际完成的项目才标通过。

现有 [AgentCookieMemoryStore 内存参考](../../fixtures/expected/README.md) 实现六个方法并运行确定性离线测试，只用于验收参考，不复制到第三方仓库，也没有接到当前双店服务。它只处理本商家白名单关系 context，不复制共享卡、不伪造 observed；未接通的 HTTP port 在启动和调用时明确报错。A15/A16、真实工作台 MemoryStore、干净克隆 skill 运行及录屏仍未通过。
