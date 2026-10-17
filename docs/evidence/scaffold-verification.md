# 骨架运行记录（不是验收通过）

日期：2026-10-17，America/Los_Angeles。分支：`lane-c`。

**实际结果：22 个 todo，0 个已实现的业务验收测试。** A10/A17 尚无真实客户端证据，A15/A16 尚无真实运行证据。以下退出码 0 只证明清单和测试收集可以运行，不代表 P0 全绿或可演示。

## 清单比对

从 `git show origin/devin/1792265075-plan-v0.3:docs/plan.md` 读取验收表，提交为 `f23abfbc26c743aef1e4d634132c0e9ddd01d4a5`。用 Node `assert` 将表内每个编号、标题、等级与 `acceptance.test.ts` 的 `it.todo` 逐项比较，并检查编号唯一、没有已实现的 `it(...)`。

真实输出，退出码 0：

```text
P0: 15 todo IDs match v0.3 exactly
P1: 7 todo IDs match v0.3 exactly
22 unique todo titles match v0.3 exactly; zero implemented tests.
```

## 依赖和运行环境

- Node：`v22.23.3`（本次临时 runtime 位于 `/private/tmp/agent-cookie-c-node22/node_modules/.bin`）。
- pnpm：`10.32.1`。
- Vitest：`4.1.10`，固定在本目录的 `package.json` 和 `pnpm-lock.yaml`。
- 安装和锁均限于 `tests/acceptance`，没有修改根锁；`.pnpm-store/` 和 `node_modules/` 不提交。
- 首次离线安装缺包、受限网络 DNS 失败；允许联网的依赖安装成功后，最终以下离线锁验证也成功。

在 `tests/acceptance` 执行：

```sh
PATH=/private/tmp/agent-cookie-c-node22/node_modules/.bin:$PATH pnpm install --offline --ignore-workspace --frozen-lockfile --ignore-scripts --store-dir .pnpm-store
```

真实输出，退出码 0：

```text
Lockfile is up to date, resolution step is skipped
Already up to date

Done in 217ms using pnpm v10.32.1
```

## Vitest 收集结果

在 `tests/acceptance` 执行：

```sh
PATH=/private/tmp/agent-cookie-c-node22/node_modules/.bin:$PATH pnpm --ignore-workspace test
```

真实输出摘要，退出码 0：

```text
RUN  v4.1.10 /Users/mac/LA Hacks 2026/tests/acceptance

Test Files  1 skipped (1)
     Tests  22 todo (22)
  Start at  12:40:34
  Duration  106ms (transform 12ms, setup 0ms, import 19ms, tests 0ms, environment 0ms)
```

本次没有启动工作台、调用业务 HTTP 接口、连接 Claude Desktop 或运行 iMessage 流程。下一步必须等冻结契约与工作台就绪，将 todo 逐项替换为 HTTP 断言，并另外采集 A10/A17 的真实手动证据。
