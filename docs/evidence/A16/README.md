# A16 · coding agent 独立接入实录

状态：**执行中，未通过**。用户已恢复本项实跑要求，取代旧说明中的“现场安装推迟”。C11 仍是 P1 BLOCKED，不因运行 skill 自动解除。

| 项目 | 记录 |
| --- | --- |
| 上游 | anthropics/commerce-agents，`fd4d59224ab96b43c6dc6888207c67b3bd5a24cf` |
| 工作台 / 契约基线 | Agent Cookie main `8c1a869fe9fc67c7d7a80dd09714d0a4d21b6954` |
| 干净克隆 | [clean-clones.json](clean-clones.json)：本机为 Claude Code、Devin 预备的两份外部 clone，启动前 porcelain 为空；Claude 使用前者。Devin 实际在云端独立克隆，本机预备 clone 不作为其执行证明，云端 SHA / clean status 待回传 |
| Claude Code | 本机 CLI 2.1.220 的 auth status 为未登录；按用户指示改用已登录的 Claude Desktop **Code 模式**，本机独立会话 `local_47eff1cb-78e5-48f2-9e1f-b7296b9b2923`，名称“A16 接入实录任务” |
| Claude 任务说明 | [claude-code-brief.md](claude-code-brief.md)，要求真实应用仓库 skill，主仓只读，不复制参考答案 |
| 录制 | [真实窗口执行片段](claude-code-contract-check.mp4) / [捕获元数据](recording.json)；通过 CUA 连续采集窗口并按实际帧间隔编码，无音频，仅一段执行片段，**不是完整连续 A16 录像** |
| Devin 录制 | [实际网页执行片段](devin-execution-excerpt.mp4) / [捕获元数据](devin-recording.json)；同样是连续采集的真实执行片段，非完整运行录像 |
| Devin | 桌面入口已找到，但原生点击工具无法操作该窗口；已打开登录的网页入口。首次发送被自动审批拦截；用户随后明确授权，已实际发送[交接说明](devin-brief.md)并创建 [Devin 独立会话](https://app.devin.ai/sessions/94dae4b1d11547c698d04be4119e41eb)，执行中，未通过 |
| 判定 | 等待执行完成后补原始日志、diff 与真实 HTTP 结果；当前不得标 A16 通过 |

完整出口要求：从干净克隆开始，定位 session / memory，生成自己的适配层，保留过滤和删除语义；实际经授权 HTTP 读到字段、写回并读回本商家 note；保存变更范围与连续录屏。没有商家 note 枚举、删除、clear、持久 generation / 条件写入契约时，不得伪造端点或用本地 fallback 绕过撤销。
