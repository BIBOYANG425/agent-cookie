# Agent Cookie CLI — 本地读卡入口

当前仅支持 `card` 和 `--pretty`。它通过 SDK 读取 `/me` 确认 personal 角色，再读 `/personal/card`；成功输出 JSON，失败向 stderr 输出不含密钥的错误并返回非零退出码。

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

`contribute / find / accept / read / grants / revoke / receipts / reset` 属于后续 T2/T3 工作，本轮不暴露空操作，也不把它们列为已支持。命令行测试使用 Sample 响应；没有连接真实商家或发起购买。
