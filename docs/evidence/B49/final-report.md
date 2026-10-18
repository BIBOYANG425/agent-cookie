# B49 最终 C 对齐与隔离验证

最终 C 快照下，B 原版六场景仍为 **1 通过、5 失败，exit 1**。另行运行的四包正式测试为 **431 passed + 4 todo**，四包类型检查通过。两组结果分别记录，不能用单元测试通过替代六场景失败。

## 六场景的实际基线

2026-10-17 17:26:59–17:27:05 PDT 执行：

- A main：`32490f19f4d22aea2f4e97e88fe8ad5975bbd39b`。lane-a `99375429b6ef61c7a2658c212c2222fd10c6e128` 的 workspace/contract 与该 main 相同。
- B 当时：`c4e40eee30639220b5818e4cac02e0c6f5317ecf`；SDK、learn、检查脚本与此提交逐字一致。
- C：**基线 `e094414c3a5a9dc581842283ea64da2b97e34b39` 加当时未提交的 rules/memory 正式类型对齐改动**，不是新的 HEAD。同步范围仅 `packages/rules`、`packages/memory-repo`、`fixtures`；118 个 C 文件及全部 221 个 A/B/C 文件的 SHA256 见 [final-baseline.json](final-baseline.json)。控制台不参与该脚本，独立证据见 [console-alignment.json](console-alignment.json)。
- 脚本 SHA256 保持 `787c06e239835a45563a38ba2061e3af576db34db7a7e87e844f2d9737613c2a`。没有修改 A/B 源码或六项断言。

运行命令仍是：

```sh
/private/tmp/agent-cookie-c-node22/node_modules/.bin/node \
  --import ./apps/workspace/node_modules/tsx/dist/loader.mjs \
  packages/sdk/test/learning-acceptance.check.ts
```

| 场景 | 最终实测 | 仍需 A 处理的位置 |
| --- | --- | --- |
| 明确陈述直接上卡 | candidate，basis=[observed] | `apps/workspace/src/services/learning.ts:292` 将 stated 降为 observed。 |
| 同 agent 两段独立对话 | candidate，证据 1、writer 1 | `learning.ts:294–295` 的同 writer/field/value 30 天去重丢掉第二段对话。 |
| 相隔 31 天的两段对话 | candidate，证据 2、writer 1 | `apps/workspace/src/services/card.ts:47–52` 仍以 writer 数量筛选，未使用 C 的独立 `evidenceSources`。 |
| 暂停、恢复后迟到结果 | **通过**：learnedCount=0，paused=false | pause epoch 生效。 |
| 排队原话从不落盘 | rawCanaryOnDisk=true | `learning.ts:83–84`、`apps/workspace/src/db.ts:226–228` 把原文排入 SQLite。 |
| 跨 agent 接受并保留历史 | handoff，memoryWriteFailures=1 | `learning.ts:126,135–136` 的 record.agentId 与 writeMeta.author 不一致；C `packages/memory-repo/src/index.ts:95` 正确拒绝，stderr 为 `SCOPE_DENIED`。 |

原始 stdout：[final-six-scenarios.json](final-six-scenarios.json)。stderr：[final-runtime-stderr.txt](final-runtime-stderr.txt)。与前两次的六项观测值一致，旧证据和 `latest-*` 均未覆盖。

## 正式包检查与已到的 B 构建修复

同一隔离 runtime 先按各包正式构建脚本构建 SDK 与 learn，再运行以下四包的 `vitest run` 与 `tsc --noEmit -p tsconfig.json`。仅使用包自带测试，未混入临时复现测试。

| 包 | 正式测试 | 类型检查 |
| --- | --- | --- |
| rules | 70 passed | 通过 |
| memory-repo | 48 passed | 通过 |
| workspace | 234 passed、4 todo | 通过 |
| SDK | 79 passed | 通过 |
| 合计 | **431 passed、4 todo** | 四包通过 |

随后到达的 B `d9aa3cea353d1c95d5b672188ab4a1dad5ad6db2` 相对 `c4e40ee` **只有根 `package.json` 的 `build:deps` 改动**，把 learn 构建加入 SDK 构建之后。已核对完整 git diff、仅同步临时副本根文件，17:28:38–17:28:39 PDT 实跑一次 **`pnpm build:deps`，exit 0**。六场景程序、断言及其它源码字节未变，未重复运行六场景；这次后续 bootstrap 验证在 baseline 的 `postProbeBootstrap` 单列，未把较早六场景的 B 基线改写成 d9aa3ce。

本地根 bootstrap 已验证通过，不能再称 B51 的根构建缺口仍未修复。主任务另行核查的 [PR20 CI run 39082777984](https://github.com/BIBOYANG425/agent-cookie/actions/runs/39082777984) 已越过 typecheck，但 test 阶段仍报 Photon `learning-workspace.test.ts:34`（期望 extractor 1 次、实际 0）和 MCP `text-workspace.test.ts`（Connection closed）。本轮没有运行 MCP/Photon 测试，不把它们算作通过，也未修改 B 源码掩盖这些远端失败。

每条实际命令、退出码、计数和耗时：[final-validation.json](final-validation.json)。完整无钥匙日志：[final-validation.txt](final-validation.txt)。环境为 Node 22.23.3、pnpm 9.12.0、better-sqlite3 11.10.0、tsx 4.23.15；其余精确依赖版本和 lockfile SHA256 在 baseline 中。

## 范围限制

全部运行于 `/private/tmp/agent-cookie-b49-runtime-hs8xs43o`。六场景使用 SDK 注入 `fetch` 调真实 A `app.request`，逐场景创建并删除临时 SQLite/git memory；测试没有连接、停止或重置现有 4310/5173/4331/4332。Synthetic extractor 和 fixture checkout 不代表实际模型、手机通道、真实商品或付款验收。一次 Git 提交也不代表 SQLite/git 原子事务或历史原文擦除。模型凭据及本机 `.env` 未进入子进程；输出中的 fixture/test key 已检查或脱敏。
