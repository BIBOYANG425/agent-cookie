# B49：当前 C 与原版 B 六场景联调

2026-10-17 17:13 PDT（2026-10-18 00:13 UTC）原样执行 B 检查：**1/6 passed，exit 1**。这不是 B49 全通过，也不是实际模型／手机通道学习成功。

## 基线与执行边界

- A `apps/workspace`、`packages/contract`：main `32490f19f4d22aea2f4e97e88fe8ad5975bbd39b`。
- B `packages/sdk`、`packages/learn` 及原检查：lane-b `0f26ddfb15f1e71f6d3c3ccb6376079bc0805a72`；其它依赖目录、lockfile 也来自此 B 快照。
- C `packages/rules`、`packages/memory-repo`、`fixtures`：以 `32490f1` 为基线的本轮未提交源码，包含 B49 evidenceSources、证据撤销与更新后的 seed；118 个输入文件的 SHA256 见 [baseline.json](B49/baseline.json)。不把此结果归因于未修改的 main。
- 隔离副本 `/private/tmp/agent-cookie-b49-runtime-hs8xs43o`；Node `v22.23.3`，`pnpm install --frozen-lockfile` 成功。运行前逐字核对 A/B 上述源码与对应 ref，未改检查断言。原检查 SHA256：`787c06e239835a45563a38ba2061e3af576db34db7a7e87e844f2d9737613c2a`。
- 脚本使用 SDK 的 `fetch` 注入调用真实 A `app.request`，每个场景创建并最终删除独立临时 SQLite/git memory。URL 中的 4310 只是进程内路由地址，不连接已有服务；没有重启、重置或访问 4310/4331/4332/5173。
- extractor 是 B 脚本明确注入的 Synthetic 函数；最后一项使用 fixture UCP 并返回 handoff，无 live model、live channel 或真实付款。测试文本、预算和颜色都是受控输入，不是产品约束。

在隔离副本根目录运行的原检查命令：

```sh
/private/tmp/agent-cookie-c-node22/node_modules/.bin/node \
  --import ./apps/workspace/node_modules/tsx/dist/loader.mjs \
  packages/sdk/test/learning-acceptance.check.ts
```

只向子进程传 PATH、临时目录、语言与 git 安全配置；Sample 钥匙由原脚本读取自己的 fixtures，不在命令或输出中。结果与 stderr 在写入证据前检查不含该 fixture 的任何钥匙。

## 原检查结果与剩余 A 接线问题

| 场景 | 实测 | 对应实现位置（A 基线如上） |
| --- | --- | --- |
| `explicit_statement_reaches_card` | 失败：`candidate`，basis 为 `observed` | `apps/workspace/src/services/learning.ts:292` 把除 inferred 外的 basis 全部转为 observed，B 返回的 stated 在到达 C 前已丢失。 |
| `same_agent_two_conversations` | 失败：`candidate`，evidenceCount=1、writerCount=1 | 同文件 `294–295` 按同 agent/field/value 的 30 天窗口去重，未按 conversation/intent 证据单位区分，第二场独立对话没有写入。 |
| `same_agent_two_conversations_after_refresh` | 失败：`candidate`，evidenceCount=2、writerCount=1 | `apps/workspace/src/services/card.ts:47–52` 用 `f.sources.length < 2` 再次拦截。C 的 `sources` 保留作者身份、独立证据由 `evidenceSources` 表示；同 writer 的两场对话仍被 A wrapper 降回候选。 |
| `pause_resume_discards_late_result` | **通过**：learnedCount=0，paused=false | `learning.ts:55–59,63–67,264–266` 的 pause epoch 校验丢弃暂停前启动的异步结果。 |
| `queued_original_never_reaches_disk` | 失败：rawCanaryOnDisk=true | `learning.ts:83–84` 排队用户文本；`apps/workspace/src/db.ts:226–228` 将原文插入 `observation_turns.text`。处理后删除不能满足原文从不落盘。 |
| `cross_agent_fixture_accept_preserves_history` | 失败：handoff，memoryWriteFailures=1 | `learning.ts:126` 保留原 intent 的 agentId，但 `135–136` 使用当前接受者生成 writeMeta.author。C `packages/memory-repo/src/index.ts:95` 拒绝 author 与 record.agentId 不一致；stderr 实际为 `SCOPE_DENIED`，不能放宽 C 作者绑定来掩盖。 |

未修改 A/B 处理这些红项；未把 Synthetic extractor 或 fixture checkout 记作真实模型／UCP 验收。C 自身的单元测试结果由相应任务记录，本报告只陈述这次未修改 B 脚本的集成结果。

原始六项结果：[six-scenarios.json](B49/six-scenarios.json)。精确基线、时间、执行命令及退出码：[baseline.json](B49/baseline.json)。实际 stderr：[runtime-stderr.txt](B49/runtime-stderr.txt)。
