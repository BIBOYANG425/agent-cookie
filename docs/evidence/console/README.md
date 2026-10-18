# 控制台当前截图 · C23

2026-10-17。独立 `127.0.0.1:5180/?learningStage=learned`，未连接真实工作台；全部为 **Sample 界面证据**，不证明模型运行、商家实际申请、真实库存或学习后的排序。

| 内容 | 当前文件 | 核验 |
|---|---|---|
| 通用身份卡 | [sample-card.jpg](sample-card.jpg) | lang、tone、budget、常用尺码、pref.material、pref.color；来源可展开 |
| 本次请求 | [sample-intent.jpg](sample-intent.jpg) | 本次 budget=85 / size=M，与卡上 budget=100 / 常用尺码=L 分开 |
| 授权 | [sample-grants.jpg](sample-grants.jpg) | 四个通用字段；仅 A 有预设 needs 事件，B 不显示；不可用字段灰色标签 |
| 回执 | [sample-receipts.jpg](sample-receipts.jpg) | 字段名、用途、商家、时间；不展示字段值 |
| 学到的模型 | [sample-learned-models.jpg](sample-learned-models.jpg) | 模型链与缺省“本地规则”；元数据为预设 Sample |
| 窄屏 | [sample-320.jpg](sample-320.jpg) | 320px 页面，DOM clientWidth=scrollWidth=320，无横向溢出 |

数据为 [通用控制台 fixture](../../../fixtures/console/generalized.json) 和 [学习 fixture](../../../fixtures/learning/console.json)。截图通过浏览器直接保存，没有合成。旧 C09/C16 截图移入 `history/`；`workspace-reset.png` 保留为 C10 历史实连证据，不是当前 UI。

57/57 控制台测试、TypeScript（含测试）、Vite build 通过。覆盖契约全部 FIELDS 的标签及保留原键、HTML 转义、请求条件不改卡、SDK 回执读取、owner 历史 GET 白名单、失败状态不假装空结果。

`getReceipts` 走现有 SDK；A 已有 GET /personal/intents，SDK 缺少历史读方法时由服务端窄范围 `TODO(sdk)` 过渡。请求条件只显示 intent.public 的显式值；不会推断卡字段/授权的有效来源。needs 的 owner 握手投影及 SDK activity.kind 仍待 A/B，见 requests。未重置或重启 4310、5173 或 Photon。
