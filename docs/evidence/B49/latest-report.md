# B49 最新 B / 已提交 C 独立复跑

2026-10-17 17:25:26–17:25:33 PDT，B 原版六场景再次实际执行：**1 通过、5 失败，exit code 1**。不是全通过，不是实际模型学习验收。旧 `baseline.json` / `six-scenarios.json` 保留不变。

## 精确基线与原样性

- A：main `32490f19f4d22aea2f4e97e88fe8ad5975bbd39b`。lane-a `99375429b6ef61c7a2658c212c2222fd10c6e128` 的 `apps/workspace`、`packages/contract` 与此 main 无差异，尚无新的 B49 后台修复。
- B：`c4e40eee30639220b5818e4cac02e0c6f5317ecf`。与前次 `0f26ddf` 相比仅 5 个协调／证据文档变化，SDK、learn 和六场景脚本未改。
- C：`e094414c3a5a9dc581842283ea64da2b97e34b39` 的 `packages/rules`、`packages/memory-repo`、`fixtures`，从 git archive 精确导出。本次不包含此提交之后的 C 调整。
- 运行前逐字比对上述 A/B/C 文件与对应提交，共 221 个文件的 SHA256 保存在 [latest-baseline.json](latest-baseline.json)。检查脚本 `packages/sdk/test/learning-acceptance.check.ts` SHA256 仍为 `787c06e239835a45563a38ba2061e3af576db34db7a7e87e844f2d9737613c2a`；源码、六项断言均未改。

## 实际结果与归因

| 原场景 | 结果 | 当前 A 接线根因 |
| --- | --- | --- |
| `explicit_statement_reaches_card` | 失败：candidate，basis=[observed] | `apps/workspace/src/services/learning.ts:292` 将 B 的 stated 降为 observed。 |
| `same_agent_two_conversations` | 失败：candidate，evidenceCount=1，writerCount=1 | `learning.ts:294–295` 按 writer/field/value 做 30 天去重，丢弃第二段独立 conversation。 |
| `same_agent_two_conversations_after_refresh` | 失败：candidate，evidenceCount=2，writerCount=1 | `apps/workspace/src/services/card.ts:47–52` 仍以 writer `sources.length` 二次筛选，未使用 C 的独立证据单位 `evidenceSources`。 |
| `pause_resume_discards_late_result` | **通过**：learnedCount=0，paused=false | A pause epoch 校验生效。 |
| `queued_original_never_reaches_disk` | 失败：rawCanaryOnDisk=true | `learning.ts:83–84` → `apps/workspace/src/db.ts:226–228` 将用户原文排入 SQLite；事后 DELETE 不满足从不落盘。 |
| `cross_agent_fixture_accept_preserves_history` | 失败：handoff，memoryWriteFailures=1 | `learning.ts:126,135–136` 的 record.agentId 取发起者、writeMeta.author 取接受者；C `packages/memory-repo/src/index.ts:95` 拒绝不一致。实际 stderr 为 `SCOPE_DENIED`，未放宽作者校验。 |

以上与最新 B52 独立复验结论一致：C 已分开证据与 writer、支持本地证据撤销 selector；正式 contract 的 `evidenceSources` / selector 与 HTTP 请求、响应语义仍需跨线冻结。一次 Git 写入不证明 SQLite/git 原子事务或历史原文擦除。本次仅运行原六场景，没有再次运行 B52 中的 SDK、rules、memory 或六包类型检查，不能将 B 的测试计数当成本轮结果。

## 环境、依赖与隔离

复用隔离 runtime `/private/tmp/agent-cookie-b49-runtime-hs8xs43o` 的成功 frozen-lockfile 安装。最新 B 的根 manifest、workspace 配置及 lockfile 与实际安装输入逐字一致；lockfile SHA256 为 `03a97f15c671b02f9283f5d3cb1c2c6461cb51b7e62eb5e067fcb6716437ac26`。

| 实际依赖 | 版本 |
| --- | --- |
| Node / pnpm | v22.23.3 / 9.12.0 |
| better-sqlite3 / tsx | 11.10.0 / 4.23.15 |
| hono / @sentry/node | 4.13.13 / 11.4.0 |
| zod / @photon-ai/otel | 3.25.76 / 3.8.1 |
| typescript（SDK 安装依赖） | 7.0.2 |

从该 runtime 根目录执行：

```sh
/private/tmp/agent-cookie-c-node22/node_modules/.bin/node \
  --import ./apps/workspace/node_modules/tsx/dist/loader.mjs \
  packages/sdk/test/learning-acceptance.check.ts
```

SDK 注入 `fetch` 调用 A 的 `app.request`，并非访问已有 4310；各场景自行创建、关闭和删除临时 SQLite/git memory。没有启动／重启／重置用户服务，没有模型凭据或本机 `.env` 进入子进程。Synthetic extractor、fixture checkout、受控测试值不代表实际模型、手机通道、真实商品或付款通过。

原始 stdout：[latest-six-scenarios.json](latest-six-scenarios.json)。原始 stderr：[latest-runtime-stderr.txt](latest-runtime-stderr.txt)。写入前已检查输出不包含 fixtures 中任一钥匙；没有为通过检查删改业务输出。
