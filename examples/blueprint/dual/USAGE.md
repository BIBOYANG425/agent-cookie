# 两个独立 Sample storefront

同一个 launcher 启动两份固定 commit 的 `ShoppingAgent` storefront。此阶段是 **bootstrap only**：没有调用 Agent Cookie 工作台，没有生成真实 pairwise ID，没有工作台 notes，也不声称通过 A08 或 LLM 验收。

| 实例 | 外部克隆 | API | Storefront |
| --- | --- | --- | --- |
| A | `/tmp/agent-cookie-commerce-agents` | 127.0.0.1:8000 | 127.0.0.1:3000 |
| B | `/tmp/agent-cookie-commerce-agents-b` | 127.0.0.1:8001 | 127.0.0.1:3001 |

二者固定为 `upstream-revision` 指定的提交，各用本克隆的 `.venv`、`examples/retail/data/.memory-store.json`、seed marker 和内存 SessionStore。两者初始 Sample 商品相同，不代表两家真实商家，也不是原版不存在的鞋商品。

**当前浏览器页面仍是 ACME 原版 UI。** A/B 与 Sample 身份只在 launcher 和本说明中区分；当前页面不能直接当作完整双商家 demo。最终演示还需在两个前端清楚显示各自的 Sample 商家身份标签，避免用户混淆实例。这个前端改动未在 bootstrap 阶段实现。

启动原版 `retail.api.main:app` 与 `retail/storefront-web`，不启动 merchant-web、不调用员工 `/api/merchant` 聊天。原版 API 模块会附带员工后台路由；这里没有把其 `MerchantAgent` 当成面向顾客的商家 agent，也没有复制或修改上游源码来移除路由。

## 安装与运行

以下从 Agent Cookie 仓库根执行。Node 必须是 22；本机已有的路径如下，其他机器使用自己的 Node 22。

```bash
export PATH="/private/tmp/agent-cookie-c-node22/node_modules/.bin:$PATH"
bash examples/blueprint/setup.sh /tmp/agent-cookie-commerce-agents
bash examples/blueprint/setup.sh /tmp/agent-cookie-commerce-agents-b
python3.11 examples/blueprint/dual/launch.py --check
python3.11 examples/blueprint/dual/launch.py
```

`--clone-a` / `--clone-b` 可改目录；`--api-a`、`--web-a`、`--api-b`、`--web-b` 可改端口。四个端口必须互异且空闲。启动器直接指定 uvicorn/Next 端口；占用时失败，不复用服务或迁移端口。启动竞态导致子进程退出时会停止整个双实例。Ctrl-C 同时停止子进程，保留克隆和演示数据。

预检除了目录和固定 commit，还由每个虚拟环境实际导入模块，检查 `sys.prefix`、editable 模块路径与 DATA_DIR。不能复制 A 的 `.venv` 给 B、给 data 建共用软链接，或让两个 store 文件是同一 hardlink。前端原生模块也须实际加载成功；npm 的 optional 包失败可能仍返回安装成功。

首次 B 安装曾漏装 `lightningcss-darwin-arm64`，已从已有下载缓存按原锁补齐。遇到同类情况，在失败克隆的 `examples` 执行：

```bash
npm ci --include=optional --no-audit --no-fund --cache /tmp/agent-cookie-blueprint-npm-cache
```

不要修改锁文件或借用另一实例的 node_modules 软链接来掩盖失败。

## 各进程的凭据边界

默认不读取父 shell 中的模型或工作台 key。确有凭据时，在仓库外分别准备两个环境文件，用 `--env-a /private/path/a.env --env-b /private/path/b.env` 指定。支持的名字只有 `ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`AGENT_COOKIE_KEY`、`AGENT_COOKIE_URL`；文件是简单 `NAME=value`，可引用带空格的值，不执行 shell、不展开变量。

两份文件必须不同；工作台 key 必须都省略，或二者均非空且不同。各 API 只收到自己的配置，前端进程拿不到任何 key。继承环境使用允许列表，父 shell 中的其他 key、PYTHONPATH 不传入。为防上游 dotenv/Next 在进程内重新加载凭据，clone 根、retail 与 storefront 目录不能有 `.env*`（`.env.example` 除外）；已有文件由用户自行迁到外部明确指定，启动器不移动或删除。

这些是进程环境隔离措施，不是同一 macOS 用户下的操作系统安全沙箱。即使配置了两个工作台 key，当前版本也仍然 `workspace_connected=false`；配置不会自动创建授权、握手、pairwise ID 或 notes。真实映射和共享的接入实现等待冻结契约与 SDK/fake workspace。

## 验证

```bash
python3.11 -m unittest discover -s examples/blueprint/dual -p 'test_*.py' -v
# 在双实例运行时，从另一终端执行：
python3.11 examples/blueprint/dual/smoke.py
```

smoke 对两套 API/页面/catalog 建立基本健康证据，再为同一个 **Sample** profile 在两套服务建立 session：自己的 token 读 memory 是 200，另一实例的 token 必须是 401。token 不写入报告。这证明的是原版 SessionStore 的进程隔离，不能当成工作台 note 隔离 A08、真实 pairwise ID、模型聊天或浏览器交互验收。

readiness 与 smoke 共用禁代理、禁重定向的 HTTP opener，不继承 HTTP_PROXY 等环境设置；所有 3xx 都使探针失败，不向 Location 指向的 origin 转发请求或 X-Session-Id。当前共 12 项本地测试，包括两个原服务的 302 不得把 token 发到第三个 origin、readiness 不接受重定向目标、代理不得收到请求或 token。

测试和预检会绑定本机临时端口。此处没有自动注入 Sample key，没有 API 付费调用，也没有删除或修改用户已有的 memory 内容。现场 coding agent 安装演示不属于当前步骤。
