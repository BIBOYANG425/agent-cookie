# PR #12 合并后的 B 线收尾

日期：2026-10-17，America/Los_Angeles。PR #12 于 15:04:16 PDT 由人合并，merge commit 为 `1352eff495872700aa7f6cf01325f09149da8807`。本地 `lane-b` 从干净状态快进到该提交；没有自行合 main。该基线相对之前运行版本未改变 workspace、rules、memory-repo、UCP 或 B SDK/MCP 业务实现，因此保留了现有 4310 后台和 Photon 状态，未重置演示数据。

## 四项任务的实际状态

| 任务 | 本轮结果 | 尚待完成 |
| --- | --- | --- |
| A10，Desktop 接真实适配器 | 真实 Claude Desktop 在 15:06:11 / 15:06:13 发出读卡与找鞋调用，15:09:31 调 list_receipts；对应 `sample-personal-desktop` 的读卡 200、intent 201、quotes 200、receipts 200。用户置前后原生 UI 与 SDK 读回一致：10995 / 11200 美分、`source=fixture`、Sample、ETA null。已存实际 Desktop 卡片 / 报价开头及回执两张画面。 | 真实 Desktop 读卡与找鞋验收通过；全仓 P0 与商家模型开场另计。 |
| 第 6 拍，换助手保持同店身份 | 新 Desktop 引介的 Black Flag 授权与 14:49:54 手机 checkout 回执的完整 session ID 完全相同；控制台新旧授权截图已保存。未新增 checkout 或 Desktop accept。 | 店家读取 `last_order` 后的真实开场尚未接通，不能判定整拍完成。 |
| SDK 写方法与依赖 | 三个写方法已实现；SDK 的隔离集成覆盖真实后台撤授权、撤贡献和 owner reset。B 包 manifest 均 `workspace:*`，无独立锁文件，根冻结离线安装通过。 | 无实现缺口，不做重复修改。 |
| iMessage 排练与失败文案 | `apps/channel-photon/README.md` 已定稿六拍流程、handoff、售罄、上游失败、blocked、ordered、过期和未知发送结果；明确 Sample、未知 ETA 与未付款。 | 真实售罄录制仍属于 A/D 验收依赖，文案不能替代它。 |

## Desktop 与跨渠道证据

- 本地 Desktop 配置确实指向构建后的 MCP 和本地 `.env`；环境身份匹配 `sample-personal-desktop`，URL 是 4310，Sample 已启用。未输出凭据。
- MCP 日志三组请求 / 返回时间为 22:06:11.767–11.839Z、22:06:13.814–14.037Z、22:09:31.659–31.671Z；后台读卡、创建意图 / 读取报价、读取回执时间落在各自窗口内。协议日志隐藏了参数，工具名称结合后台路径和原生 UI 核对，未声称从隐藏参数读取。
- 中间的 SDK 核验也用了 Desktop 身份读取 receipts / quotes；这些 readback 与 15:09:31 的实际 Claude `list_receipts` 调用分别记录，不混算工具调用次数。
- 对照的手机回执是既有真实 iMessage 在 14:49:54 选择第二双时产生的 checkout 回执，不是本轮新生成的回执，也不是此前本地探针的旧记录。
- 比较时使用完整 session ID，脱敏 JSON 保存双方 SHA-256 指纹和相等结果。控制台只展示 `jrrg7b6g` 短 ID；短 ID 相同只是可视证据，完整相等由 SDK 返回值核对。
- 新 Desktop handshake 授权到期于 15:16:13；手机 checkout 授权到期于 14:59:54。相同 session 不代表旧授权复活，也不代表新查询获准读地址。

机器结果：[2026-10-17-postmerge-b-verification.json](2026-10-17-postmerge-b-verification.json)。实际截图：

| Desktop 新引介的授权 | 手机选择后的历史 checkout 授权 |
| --- | --- |
| ![新授权，同店 session 短 ID](2026-10-17-postmerge-same-session.jpg) | ![手机 checkout 授权，相同短 ID](2026-10-17-postmerge-phone-session.jpg) |

两张均为本机控制台真实截图，无重绘或拼接；这是 session 连续性截图，不是 Claude Desktop 结果截图，也不是商家开场截图。

实际 Desktop 回执截图：[2026-10-17-claude-real-adapters-result.jpg](2026-10-17-claude-real-adapters-result.jpg)。UI 明确说明两条 Black Flag checkout 回执来自历史，本轮没有 accept、下单或付款，也没有编写商家欢迎语。这里用于手机对照的是 21:49:54Z 那条，21:34:08Z 是此前本地联调，二者不能混淆。

实际 Desktop 卡片 / 报价开头截图：[2026-10-17-claude-real-adapters-card-quotes.jpg](2026-10-17-claude-real-adapters-card-quotes.jpg)。视口完整显示 Sample、zh、简短、42，以及 find_agents 标题和第一条 $109.95 / fixture；第二条报价在视口下方，其 $112.00 / fixture 由同次原生无障碍树与 SDK 结果核对，不声称此原图完整显示两行。截图未裁剪、拼接或重绘。图中的 sample-personal-photon 是卡片贡献来源，实际调用身份已由本地配置和后台活动确认是 sample-personal-desktop。

## 商家开场阻塞及交接

`apps/workspace/src/services/commerce.ts` 在 ordered / handoff 后写入本商家的 `last_order`。当前 UCP find 返回的是目录报价，没有调用商家会话去读 note 或生成欢迎语。`Quote` 不含 sessionId / note；个人 MCP 也不应绕过商家隔离读取商家私有 note。不会为了截图把 owner 权限或 merchant note 暴露给个人助手。

C 远端 `c04fe17` 本轮新增的是实测证据与交付文档，没有新的商家接线实现。C 的 `docs/evidence/A15/README.md` 记录了工作台 `{session_id,message}` 与上游 `/api/session`、`X-Session-Id`、SSE 协议尚未适配；即使单独采用正确协议，也因未配置 Anthropic 模型凭据而只有 SSE error。本机 8000 同样没有监听。C 的原版 ACME 与本轮 Black Flag UCP proxy 是不同商家，不能拼接成“同店回来就认识用户”。

需要 A/C 明确承担第 6 拍的商家：在同一个受信 merchant/session 下读 `last_order`，通过实际商家模型生成开场，提供可运行入口及相应凭据配置路径，然后 B 再补真实截图。handoff 写下的 note 只表示用户上次选择 / 交接的商品，不能说成“上次已经买了”。如果需要新的 SDK 或 MCP 载荷，先由两线确认契约，不在 B 私造端点。

## 本轮验证

- 根 `pnpm install --frozen-lockfile --offline`：通过，锁文件未变化。
- SDK：60 tests passed，含三个控制台写方法、取消语义、八条真实 console 桥接路由、真实 rules / Git memory-repo / fixture UCP 隔离集成。
- MCP：7 tests passed；Photon：39 tests passed。合计 106 项。
- SDK、MCP、Photon typecheck 和 build：通过。
- 所有写方法测试使用临时数据库 / Git 目录；未操作当前手机数据库的 revoke/reset，未更改 Photon cursor / outbox，未新增付款或下单。
- 未重跑 A/C/D 全套验收，未声称全仓 P0 全绿；之前 B31 的 A 测试误匹配问题与本轮 B 验证分开。
