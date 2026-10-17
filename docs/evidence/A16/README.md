# A16 · coding agent 独立接入实录

判定：**两次实跑已完成，有限 preferences / note 接入验证通过；完整 A16 / C11 仍为 P1 BLOCKED**。两者都无法实现契约尚缺的六方法 MemoryStore。没有把局部 HTTP 成功或单元测试称为完整接入。

| 项目 | Claude Desktop Code | Devin |
| --- | --- | --- |
| 实际执行 | 本机 Code 模式，会话 `local_47eff1cb-78e5-48f2-9e1f-b7296b9b2923`，名称“A16 接入实录任务”；CLI 未登录，按用户指示使用 Desktop | 用户明确授权后发送，[Devin A16 独立实跑](https://app.devin.ai/sessions/94dae4b1d11547c698d04be4119e41eb)，云端独立克隆 |
| 上游 | `anthropics/commerce-agents@fd4d59224ab96b43c6dc6888207c67b3bd5a24cf` | 同一固定上游提交，独立生成，没有复用 Claude 的代码 |
| 工作台 / 契约 | `8c1a869fe9fc67c7d7a80dd09714d0a4d21b6954`，隔离 Sample 状态，`:4320` | 同一提交，云端隔离工作台与 Sample 状态 |
| 干净基线 | [实际基线](claude-code/baseline-git.txt) | [云端实际基线](devin/00-baseline/git-baseline.txt)；本机预备的 Devin clone 未参与云端运行 |
| 基线 / 改后测试 | 1104 / 1125 passed，均 1 skipped；新增 21 项；ruff / format / check.py 通过 | 1104 / 1114 passed，均 1 skipped；新增 10 项；ruff / format / check.py 通过 |
| 真实 HTTP | [34/34 步记录](claude-code/live-e2e.jsonl)：读 `lang/tone/shoe_size=42`，写/读 `fit_notes`，隔离、撤销、到期；工作台为真实网络 HTTP，retail 在进程内 ASGI 驱动 | [29/29 步记录](devin/20-http/results.json)：读 `lang/tone/shoe_size/budget`，写/读 `fit_history`，隔离、撤销与到期 |
| 完整 MemoryStore | 构造时抛 ContractUnavailable；相关 memory / purge 路径 501 | Tier 2 启动时抛 ContractUnavailable；相关 memory / purge 路径 501 |
| 模型聊天 | 没有 Anthropic API key，SSE 凭据错误；未验证 | 没有 Anthropic API key；未验证 |
| 变更范围 | 外部克隆的 adapter、main wiring、21 项测试；[完整 diff](claude-code/generated.diff) | 外部克隆的 adapter、main wiring、10 项测试；[完整 patch](devin/30-diff/a16-adapter.patch)，未提交/推送 |

## 原始材料与判定边界

- Claude：[执行说明](claude-code-brief.md)、[完整报告](claude-code/REPORT.md)、[文件清单与脱敏记录](claude-code/manifest.json)、[真实窗口执行片段](claude-code-contract-check.mp4) / [捕获元数据](recording.json)。父代理的连续窗口采集只有约 15 秒，**不是从干净克隆到完成的全程录像**。
- Devin：[已发送说明](devin-brief.md)、[网页实际执行片段](devin-execution-excerpt.mp4) / [捕获元数据](devin-recording.json)。另已下载并核验 [55.6 秒原速终端录像](devin/devin-http-realtime.mp4) / [元数据](devin/video.json)，展示真实 HTTP 检查；这是验证阶段录像，**不是从干净克隆开始的完整生成过程**。网页“0 events recorded”并不代表视频为空；父代理核对视频时长、编码和三个时刻的真实画面。
- [clean-clones.json](clean-clones.json) 仅记录本机两份预备 clone；Devin 的实际基线以其云端日志为准。

Devin 首次聊天结论写了“A16 passed”；收到校准后已在[修正判定](devin/VERDICT.md)明确承认该措辞不对，实际通过的是有限 preferences / note 接入。原始 `results.json` 中的 `a16_core` 标志也只代表该局部脚本判定，不改变本索引的 **BLOCKED** 结论。

两者都关闭了未接入的本地持久 memory、自动提取及 Sample seed；没有用本地 fallback 掩盖撤销或过期。Claude 通过真实 introduce callback 得到 pairwise ID；Devin 测试用 Sample personal 侧 grants 构造受信 host 映射，仍需冻结真实商家接收映射的交付契约。两者都没有实现完整 note 枚举、删除、clear、持久 generation / 条件写入，也没有验证真实模型回复。

完整出口仍需：契约补齐后生成真正 MemoryStore、保留原有过滤和删除语义、经授权 HTTP 读字段及读写本商家 note、保存完整变更范围与连续运行录像。当前局部实跑为后续契约和 skill 迭代提供依据，不解除 C11。

## 脱敏与独立核对

Devin 下载的原件留在仓库外。上游聊天 `session_id` 与 `X-Session-Id` 是凭据，已在[HTTP 副本](devin/20-http/raw-http.redacted.log)和[原版诊断副本](devin/00-baseline/retail-original-http.redacted.txt)中替换；[manifest](devin/manifest.json)记录原件/副本哈希及替换次数。原终端的“no keys found”只扫描 `ck_`，不作为全面脱敏证明。Claude 的原版诊断副本同样脱敏；公开 Sample pairwise ID 和不可还原的来源 tag 保留。

父代理核对两个结果文件、测试日志、diff 的文件范围；Devin patch 对固定上游的 `git apply --check` 通过。该检查不执行下载脚本，也不扩大为产品适配器交付。[Devin 修正结果页截图](devin-result.png)供会话追溯。
