# Agent Cookie CLI — 本地读卡入口

支持 `card`、`funnel`、`policy show|shadow|set`、`links list|approve|decline` 和全局 `--pretty`。`card` 通过 SDK 读取 `/me` 确认 personal 角色，再读 `/personal/card`；成功输出 JSON，失败向 stderr 输出不含密钥的错误并返回非零退出码。

- `funnel [--since <iso>] [--limit <n>] [--json]`（owner 钥匙）：每个 intent 一行——intent id、时间、introduced、quoted、首个报价毫秒、accepted、outcome、fields read/granted、receipts、sellers picked/eligible。`sample: true` 时表头标 `Sample`。只有计数和 id，没有字段值。
- `policy show [--json]`（personal 或 owner 钥匙）：policy id、来源，以及字段 × 类别表（`auto`、`purpose:<p>`、`-` 拒绝，`w` 可写）。
- `policy shadow <file.json>`（owner）：每条变化一行 `ref kind field before -> after`，最后是 unchanged 计数；不安装任何东西。
- `policy set <file.json>`（owner）：打印新的 policy id；422 时每条违规单独一行写到 stderr，退出码 1，已安装的文档不变。
- `links list [--json]`（owner）：公司助理（Manus、Dots、Muse）的连接请求，新的在前：id、agent、agent id、状态、创建/过期/决定时间；有 pending 时提示批准命令。
- `links approve <id>` / `links decline <id>`（owner）：通过 SDK 的 `approveLink` / `declineLink` 决定一条请求；批准时打印助理的 pairwise session。已决定或已过期返回 `409 LINK_NOT_PENDING`，退出码 1。批准只由主人做，不自动批准；id 在本地校验，不回显。

策略文件可以是 PolicyDocument，也可以直接用 `policy show --json` 的输出（外层 `{ policy }` 会被拆开）；文件上限 64 KB，读不了或不是 JSON 对象时在本地报错，不回显文件内容。地板规则只由工作台判断。

使用 Node 22，先按 `../sdk/README.md` 安装、构建 SDK，再从仓库根运行：

```sh
pnpm install --ignore-scripts
pnpm --dir packages/cli typecheck
pnpm --dir packages/cli test
pnpm --dir packages/cli build
node packages/cli/dist/main.js --help
```

把 `env.example` 复制为本目录的 `.env`，在本机填入 A 线工作台颁发的个人 key。不要提交或转发 `.env`。工作台启动后：

```sh
node --env-file=packages/cli/.env packages/cli/dist/main.js card --pretty
```

包声明了 `agent-cookie` 可执行入口；当前没有进行全局安装。Skill 使用前先确认本机能运行 `agent-cookie --help`。

`contribute / find / accept / read / grants / revoke / receipts / reset` 属于后续 T2/T3 工作，本轮不暴露空操作，也不把它们列为已支持。从仓库根直接运行源码：`AGENT_COOKIE_KEY=… pnpm --filter @agent-cookie/cli dev policy show`。命令行测试使用 Sample 响应；没有连接真实商家或发起购买。
