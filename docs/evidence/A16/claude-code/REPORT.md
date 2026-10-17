# A16 接入实录：Claude Code · commerce-agents 干净克隆

## 结论

**A16：BLOCKED（C11，P1）。** 按计划 A16 要求的是“生成的 MemoryStore 读到握手字段并写回 note”；完整的六方法 MemoryStore 在现有商家 HTTP 契约下不能如实实现，因此没有生成，也不声称通过。

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 实际读取获准字段（真实工作台 HTTP） | **已完成** | `live-e2e.jsonl`：`GET /agent/handshake` + `GET /agent/fields` 读到 `lang=zh`、`tone=简短`、`shoe_size=42`（Sample 卡数据）；未请求 purpose 字段 `shipping_address` |
| 写自己的 note 并读回（真实工作台 HTTP） | **已完成** | `save_memory` → `PUT /agent/notes/fit_notes`；`recall_memories` → `GET`；用商家 A 的 key 直接 GET 交叉核对一致；商家 B 读同一 note 得 404 |
| 完整六方法 MemoryStore（含 delete / clear / purge_generation） | **BLOCKED（C11）** | 商家 HTTP 没有 note 枚举、删除、clear、持久 generation/条件写入；`AgentCookieMemoryStore()` 构造即抛 `ContractUnavailable("TODO(contract): …")` |
| 模型聊天 | **未验证** | 本克隆没有 API key；授权有效时 `/api/chat` 通过 gate，随后返回原版“无凭据”SSE 错误；撤销/过期后 gate 在模型前返回 403 |
| 录屏 | 不在本次范围 | 由父代理捕获真实 UI；本目录没有生成任何模拟视频或截图 |

已交付的是 skill 末段允许的范围化接入（get_preferences + save_memory/recall_memories 接缝，关闭本地持久 memory、提取和 seed）。它**不包含**完整删除、清空、自动提取，也**不等于** A16 的完整 MemoryStore 接入。

## 基线

- 目标：`/private/tmp/agent-cookie-a16-20261017/claude-code`，`anthropics/commerce-agents` @ `fd4d59224ab96b43c6dc6888207c67b3bd5a24cf`，`main`，开始时工作树干净（`baseline-git.txt`）。没有嵌套 git 仓库。
- 原版测试：1104 passed / 1 skipped；`ruff check`、`ruff format --check`、`scripts/check.py` 全部干净（`baseline-pytest.txt`、`baseline-lint.txt`）。
- 原版服务：retail API :8010 启动正常，demo-user seed 载入 3 条事实；`/api/chat` 返回“No Anthropic API credentials are configured”（`baseline-retail-run.txt`）。
- 测试工具：共享 venv 没有 pytest，所以把仓库自身固定版本（pytest 9.1.1、pytest-asyncio 1.4.0、ruff 0.16.3）装进 `devdeps/`，通过 `PYTHONPATH` 使用；没有修改 `/private/tmp/agent-cookie-commerce-agents`。
- 契约：只读核对主项目 `packages/contract/src/{types,policy,apis,endpoints,errors}.ts` 与 `apps/workspace/src/{app,auth,http}.ts`、`services/{notes,fields,sessions,commerce,delivery}.ts`（开始时主项目 HEAD `8c1a869`）。运行期间主项目前进到 `c04fe17`（他人的纯 docs 提交）；`packages/contract/src` 与 `apps/workspace/src` 在两者之间 diff 为 0 行。

## 定位结果

- 受信 session 路径：`examples/demo_common/storefront.py:192` `POST /api/session {user_id}` → `SessionRecord.user_id` → `shopping_agent/executor.py:103` `memory_subject = session.user_id`；Messages API 的 `orchestrator.py:289` 预取用 `fetched()`，会吞掉异常继续跑模型。
- memory 协议：`commerce_common/memory.py:78` 六个 async 方法；`check_memory_store` 在启动时检查；`extract_and_store` 在提取前后比较 `purge_generation`。
- 读写面：prompt 预取（`tier_one`、`get_preferences`）、`save_memory`、`recall_memories`、post-turn 提取、`GET/PATCH/DELETE /api/memory`、`POST /api/reset`（clear + reseed）、启动 seed（`MemorySeeder`，对 demo-user 写 Sample 事实）。偏好另有来源：`mock_retail.py:326` 读 users fixture。

六方法与现有商家 HTTP 的对应：

| 方法 | 现有 HTTP | 结论 |
| --- | --- | --- |
| `get_facts` / `search_facts` | 只有单键 `GET /agent/notes/:key`，无枚举 | 只能读主机预先允许的已知键，不等于全量 |
| `upsert_facts` | 单键 `PUT`，无批量原子性 | 单条可写；批量部分失败语义未冻结 |
| `delete_fact` | 无 | BLOCKED；不能用空 PUT 替代 |
| `clear` | 无（`/demo/reset` 是 owner 全库重置，`MemoryRepoApi.deleteNote` 是内部接口） | BLOCKED |
| `purge_generation` | 无持久 generation，无条件写入 | BLOCKED；客户端计数无法跨进程/重启 |

## 生成内容（未提交、未推送）

```
 M examples/retail/api/main.py                     (+13 −6，wiring)
?? examples/retail/api/agent_cookie.py             (476 行，适配器)
?? examples/retail/api/tests/test_agent_cookie.py  (353 行，21 项测试)
```

完整 diff：`generated.diff`。

- **开关**：只有 host 同时设置 `AGENT_COOKIE_URL` 与 `AGENT_COOKIE_KEY`（商家 key，绝不来自工具参数）才启用；否则 `main.py` 行为与原版完全相同（原 1104 项测试仍通过）。
- **主体绑定**：`POST /api/agent-cookie/session {session_id: <pairwise>}` 先用商家 key 调 `GET /agent/handshake` 核实，再新建一个独立 storefront 主体 `agent-cookie-<随机>`（不是 demo-user，不共享），绑定按服务端签发的 storefront session id 记录。别家的 pairwise id 得 404。
- **模型前授权 gate**：ASGI 中间件在每个 `POST /api/chat` 前重新调 handshake；撤销 → 403 `GRANT_REVOKED`，过期 → 403 `GRANT_EXPIRED`，不可达 → 502；不进入模型，也不用旧 history 兜底。
- **字段读取**：`get_preferences` 每次调用都 handshake + `/agent/fields`，只取风格三值与该类别 auto 字段中 handshake 列出的名字；不读 purpose 字段，不缓存，失败时抛出（预取得到空偏好而不是旧值）。
- **关系 note**：只允许 host 的 `AGENT_COOKIE_NOTE_KEYS`；身份卡字段名不能作为 note 键；先走原部署的 fence 与 write filter（`MemoryRuntime.validate`），被拒、键不合规时不发 HTTP；来源 session tag 保存在本商家自己的 note 值里（JSON，`v:1`），读回时恢复 `updated_at`。不写 contribution，不把任何内容标为 `observed`。
- **缺契约的操作**：`/api/memory`（GET/PATCH/DELETE）与带 `clear_memory`/`purge_memory` 的 `/api/reset` 返回 501 `TODO(contract)`；`NoMemorySeed.reseed` 抛错；本地 `JsonFileMemoryStore` 不实例化，提取因此关闭。
- **生命周期**：httpx 超时 5 s，无重试（契约未声明这些调用幂等）；启动时 `GET /me` 必须是已知类别的 merchant key，否则启动失败；关闭时 `aclose()`。

## 测试

- 新增 21 项离线测试（httpx MockTransport 模拟商家路由）：完整 store 不可构造、未配置即关闭、卡字段/非法键不能当 note 键、每次重新读字段且不读 purpose 字段、撤销与过期（读/写/召回都报错且无旧值）、note 往返带来源、未知 note 视为不存在、两主体/两商家隔离、邮箱/卡号/卡字段键/未允许键不触达 HTTP、note 限额报错不吞、不可达报错、未绑定 session 走原路径、提取与 seed 关闭、绑定路由 + 模型前 gate + 501 路由 + 关闭客户端、非商家 key 启动失败。全部通过（`after-pytest-agent-cookie.txt`）。
- 改后全量：1125 passed / 1 skipped；ruff、format、check.py 干净（`after-pytest.txt`、`after-lint.txt`）。
- 实跑：独立工作台副本（`workspace-runtime/`，复制自主项目 `8c1a869` 源码，端口 4320，数据目录在本结果目录，`AGENT_COOKIE_TEST=1` 以使用 `/test/clock`）；用 HTTP 注册两家 shoe 商家，Sample 个人 dev key 建 intent，从真实 introduce callback 拿 pairwise id；在进程内以 ASGI 驱动 Agent Cookie 模式的 `retail.api.main`（工作台一侧是真实网络 HTTP）。**34/34 步通过**（`live-e2e.jsonl`、`live-e2e-stdout.txt`）。stdout 里的两段 traceback 是预期日志：无 API key 的模型调用，以及撤销后 `get_preferences` 按原版失败梯级报“暂不可用”。

## 未验证与已知差异

- 模型聊天未验证（无 API key）；Tier 0 前缀未涉及；storefront-web 没有发起 `/api/agent-cookie/session` 的界面。
- 绑定保存在进程内存：重启或多 worker 时丢失，表现为“未绑定”（失败关闭，不会读到别人的数据），不是持久映射。
- 浏览器提交 pairwise id 是本 demo 的凭据替身（与原版 `user_id` 同一姿态）；真实部署需要受信 host 从 introduce callback 或签名握手建立映射。
- 单条删除、clear、generation、删除后并发提取防复活：均因 C11 未实现；提取已关闭，所以本接入不存在提取回写路径，但也不提供删除。
- note 2048 字节上限只由工作台判定；`notes.ts` 与 `MemoryRepoApi` 的计数口径不一致仍待统一。
- 仓库约定“新模块要更新 CLAUDE.md 与 README”；按 brief“只含适配器、必要 wiring 与相关测试”，本次没有改文档。

## 需要 A/B 冻结的契约（C11 范围化提议）

只作用于当前受信 merchant + session：note 键枚举、单键删除、clear（返回新 generation）、持久 purge generation 读取、带 generation 前置条件的写入（不匹配 409），并写明认证、撤销/过期、未知键、幂等与返回值，以及统一 2048 字节口径。这些冻结后，`AgentCookieMemoryStore` 可以替换现有的范围化接缝，六个方法直接映射到 HTTP。

## 本目录之外的副作用

- 无提交、无推送；主项目与 Devin 克隆未改动；`/private/tmp/agent-cookie-commerce-agents` 未改动。
- 克隆中的忽略文件（`.ruff_cache`、测试和基线生成的 `examples/retail/data/.memory-*.json`）已删除，现状见 `after-git-status.txt`。
- 自建的工作台（:4320）与回调监听（:8013）已停止；重跑方法：`workspace-runtime/start-workspace.sh`，然后执行 `e2e_live.py`（每次运行都会注册两家新商家，并对 Sample 用户新建 intent）。

## 命令

```bash
# 基线与改后（在克隆根目录）
PYTHONPATH=../claude-code-results/devdeps /private/tmp/agent-cookie-commerce-agents/.venv/bin/python -m pytest -q -p no:cacheprovider
../claude-code-results/devdeps/bin/ruff check . && ../claude-code-results/devdeps/bin/ruff format --check .
/private/tmp/agent-cookie-commerce-agents/.venv/bin/python scripts/check.py
# 实跑
../claude-code-results/workspace-runtime/start-workspace.sh &
/private/tmp/agent-cookie-commerce-agents/.venv/bin/python ../claude-code-results/e2e_live.py
```
