# commerce-agents 接入地图

核对 commit：`fd4d59224ab96b43c6dc6888207c67b3bd5a24cf`，来源 [anthropics/commerce-agents](https://github.com/anthropics/commerce-agents/tree/fd4d59224ab96b43c6dc6888207c67b3bd5a24cf)。以下是源码检查结论，不是已通过的 Agent Cookie 适配实现。复用时检查 HEAD，行号可能变化。

- storefront 注入点：`examples/retail/api/main.py:40` 的 `JsonFileMemoryStore`。`:63` 的 `InMemoryMemoryStore` 是员工后台，别换错。
- memory Protocol：`commerce-common/commerce_common/memory.py:78–98`，六个 async 方法 `get_facts`、`upsert_facts`、`search_facts`、`delete_fact`、`clear`、`purge_generation`。`:108` 的 `check_memory_store` 在启动时检查完整性。
- 主体：`shopping-agent/core/shopping_agent/executor.py:103` 返回 `session.user_id`。Messages API runtime 的 `orchestrator.py:279–298` 对同一个 user_id 读写 memory。不是 `session.session_id`。
- session 建立：`examples/demo_common/storefront.py:192`，`POST /api/session {"user_id":"..."}` 返回随机 `session_id`。这是本机无认证 demo profile，不是可信身份认证；仅受信的集成 host 可以把已验证 pairwise ID 映射为该 user_id。
- chat：`storefront.py:204`，`POST /api/chat` 携带 `X-Session-Id`，JSON `{ "message": "...", "page": { "page_type": "home" } }`。`message` 1–4000，`page` 可省略。SSE 的 `event:` 是类型，`data:` 是 payload。
- 字段对象：`commerce-common/commerce_common/types.py:34` 的 MemoryFact：key≤64、value≤200、category、updated_at、source_session_id。来源是 session tag，不得泄露作为凭据的原始 session token。不要把卡的 field 字典当作完整 MemoryFact。
- 原过滤：`memory.py:183` 的 `validate_fact`，以及 `MemoryRuntime.validate/save/extract`。默认拦截长数字、IBAN、邮箱；保留部署自定义 filter 和 fence，不能传 `write_filter=None` 跳过。
- 原删除：`examples/demo_common/memory.py:84–94` 的 GET/DELETE memory 路由；`storefront.py:236` 的 PATCH；`:255` 的 reset。clear 会增加 purge generation；`memory.py:521–535` 在提取前后比较它。单条删除与全部清空必须具有真实语义，不能总返回成功。
- 启动 seed：`main.py:57` 创建 MemorySeeder；`storefront.py:185` 启动时运行；`examples/demo_common/memory.py:54` 对 demo-user 写 Sample facts。外部 store 必须明确如何隔离/停用 seed；仅替换注入行会触发未绑定主体写入。
- preferences 不只来自 memory：`examples/retail/api/mock_retail.py:326` 从本地 users fixture 读取；未知主体得到 Guest。避免用现有 demo-user 的 seed/profile 假装读到了工作台字段。

正式 A 契约已在 `bd9d6e3` 的 `packages/contract/src/{types,policy,apis,endpoints}.ts`，尚未合入 main。实际商家 note 路由在 `apps/workspace/src/app.ts`：`GET /agent/notes/:key?sessionId=` 返回 `{key,value,updatedAt,expiresAt}`；`PUT` 同一路径接收 `{value:string}`，返回 `{key,updatedAt,expiresAt}`；Bearer merchant key。每次读写都先检查 session/grant，读取会续期。HTTP 尚无删除、枚举、clear/generation/CAS；`MemoryRepoApi.deleteNote` 是内部调用，商家不能直接使用。

容量仍须跨层统一：A 的 `services/notes.ts` 按全部 `[key,value]` 的 JSON UTF-8 字节计 2048，而 `MemoryRepoApi` 要求整个渲染 note 文件不超过 2048。完整 MemoryFact 的 note 编码、批量写入原子性和来源字段映射没有冻结；不能把现有 PUT 方法当作已解决这些语义。

[六方法内存参考](../../../fixtures/expected/README.md) 已有离线测试。它只接收受信 host 的主体绑定和白名单关系 context，复用上游 fence/filter；既不读取共享卡，也不自动创建 observed contribution。HTTP port 明确拒绝启用。`clear` 的 generation 测试使用真实上游 `extract_and_store` 与显式模型 fixture；不是模型 API 或工作台验收。单条删除不升 generation，跨进程检查后写入的窗口仍未解决。

基线仅含通用 Sample 商品，不能把它宣传成已验证的真实鞋店。模型 key、固定 Node 22 环境、Tier 0 前缀语义和 A15/A16 证据分别核对，不能互相替代。
