# B 独立复验 C 的 B49 更新

2026-10-17 17:20 PDT。C 新提交 `e094414` 的相关源码已在隔离副本复验，**尚未合进 lane-b 或 main**。本报告不改变旧验收结果，也不表示真实学习闭环已完成。

## 精确范围

- 基础树：lane-b `605afdc0efedbcccc7f4ccc5f1fa69c72df7d7cf`，包含 main `32490f1`；A 最新远端为 `9937542`，没有新的 B49 后台修复。
- 覆盖目录：仅从 C `e094414c3a5a9dc581842283ea64da2b97e34b39` 取 `packages/rules`、`packages/memory-repo`、`fixtures`，其余仍来自上述 B 树。
- 全部检查在临时副本执行，未复制本机 `.env`，测试数据独立临时创建和清理。原六场景通过 SDK 注入调用 A 的 `app.request`，没有连接现有 4310。
- C 此提交也含 stock-memory skill 工作；本轮只核查上述依赖的兼容性，没有把整条 C 分支带进 PR20，没有改全局 skill 或 Claude 配置。
- 模型响应仍为合成抽取器，checkout 为 fixture。零真实模型请求、零真实手机消息、零真实下单/付款。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 根锁安装、SDK / learn 构建 | 通过；安装使用 frozen lockfile |
| SDK / rules / MCP / Photon / memory-repo / workspace 类型检查 | 通过 |
| rules 测试 | 70 通过 |
| SDK 测试 | 79 通过 |
| memory-repo 测试 | 48 通过 |
| 原六场景验收 | **1 通过、5 未满足，退出码 1** |

隔离安装最初禁用了安装脚本，SQLite 原生模块缺失导致首次数据库检查无法执行。补齐相同版本 `better-sqlite3@11.10.0` 的 Node 22 原生依赖并验证内存数据库可用后，重跑取得以上 SDK / memory / 六场景结果。首次环境错误不计为业务失败或成功。

原六场景源码及断言未修改，当前仓库与隔离副本 SHA256 均为 `787c06e239835a45563a38ba2061e3af576db34db7a7e87e844f2d9737613c2a`。机器可读结果见同名 `.json`。

| 场景 | 实际结果 |
| --- | --- |
| 明确陈述直接上卡 | 仍是 candidate / observed |
| 同 agent 两段不同对话 | candidate，只有 1 条证据、1 个 writer |
| 间隔 31 天后两段对话 | candidate，已有 2 条证据但只有 1 个 writer |
| 暂停、恢复后迟到结果 | 通过：learnedCount=0、paused=false |
| 排队原话从不落盘 | 未通过：临时 SQLite/WAL 中找到原话金丝雀 |
| Desktop 发起、Photon 接受并写历史 | fixture handoff 成功，memory.write(intent) 仍失败 1 次，SCOPE_DENIED |

## 已解决的 C 部分与 A 接入要求

C 增加 `evidenceSources` 来表达独立 conversation/intent 证据，同时保留 `sources` 表达 writer。C 的规则测试覆盖同 agent 两来源及别名去重；当前 A 仍把 stated 降为 observed、按 30 天去重，并在 card wrapper 用 writer 数量二次拦截，因此新增 C 逻辑尚不能改变上述 HTTP 验收结果。

C 增加按 evidence 选择的批量贡献撤销和当前操作作者一致性测试。该 selector 目前是 C 的局部类型扩展，正式 contract/HTTP 尚未发布；B 未自创 SDK 请求体。一次 Git commit 不等于 SQLite 与 Git 原子事务，也不等于历史原文物理擦除。A 仍需按 B50 完成内存原话队列、事务性 forget、接力作者映射、loadLearn 与根 build:deps。

请 A 与 C 将 `evidenceSources` 的返回类型、证据撤销 selector 及 HTTP 请求/返回语义落入正式契约；随后 B 再接 SDK/Photon。当前按真实 contributionId 撤销和保守提示保持不变。

PR20 此时仍 OPEN、MERGEABLE，未合并、未启用 auto-merge。第二次 CI `39082073714` 重现已记录 B51 的 learn 构建缺口，没有新的错误类别。本轮仅追加复验证据，不把隔离 C 结果当成 PR20 已包含的实现。
