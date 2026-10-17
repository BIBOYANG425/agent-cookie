# C17–C20 · 动态记忆与对话旁听学习

状态：组件与 Sample 演练已验证，**真实 B learn → A 工作台 → 报价排序尚未通过**。本页不会用预写 fixtures 证明模型完成了提取。

## 已确认的接线缺口

2026-10-17，读取本机真实工作台 `127.0.0.1:4310`：`GET /me` 返回 200、role=owner；同一服务 `GET /personal/learned` 返回 404、`NOT_FOUND`。未发送学习、暂停或 reset 写请求。钥匙来自进程环境或本机 Sample owner 绑定，不写入证据。

已读取 B 后续提交的 [学习计划（35f6b38）](https://github.com/BIBOYANG425/agent-cookie/blob/35f6b38/docs/lane-b-learning-plan.md)。A `b824139` 尚无动态学习正式类型。接口缺口已追加 [requests](../requests.md)。C 的本地扩展与响应投影都标 `TODO(contract)`。

B 的 SDK 提案是 `getLearning()` / `setLearning({ enabled })`，C 已按该参数形式接线。人的明确 HTTP 要求 `GET /personal/learned`、`PUT /personal/learning` 优先于 B 计划里尚待冻结的 GET/POST 提案；缺 SDK 方法时，HTTP 回退只访问人指定的路径。B 的 `confirmed` 不是已冻结的 `on_card`，`id` 也尚未承诺是 contributionId：界面保留“已确认、上卡状态待对齐”，逐条撤销禁用并说明缺 ID 映射；不会伪造来源或操作 ID。正式契约到达后再解除这些限制。

B 的白名单/敏感内容过滤在学习入口；C 的 `pref.*` 语法校验不等于允许模型学习或允许商家读取该字段。这里的徒步/防水字段只是人的演示要求对应的 Sample，尚不是 A 已批准的生产白名单。

## 演示步骤与判定

1. 从空“学到的”视图开始，开关为允许学习。
2. 对个人 agent 说：“周末又去徒步，上次脚湿透了”。同一个 conversationId 下，`pref.outdoor_activity` 和 `pref.water_resistance` 各自只有一个来源，均应是**候选**。重复这句话不构成第二个来源。
3. 说：“帮我找双鞋”。这句话不构成“偏爱防水”的独立佐证；个人 agent 可以结合当前对话上下文查找，但不能因此谎称防水偏好已双源上卡。
4. 核对真实报价：≤2 家、价格不超本次用户预算；尺码不匹配/无法校验时有说明；有明确 catalog 属性证实防水命中的合格商品，在其他排序条件相同时优先。截图必须包含本次输入、相关学习条目、实际报价顺序和数据模式，不能用商品名猜防水属性。
5. 单独演示晋升：加入另一段独立对话中同字段同值的证据后，才成为 medium 身份卡条目。撤销其中一条贡献后，剩余单源退回候选。
6. 暂停学习后再聊几句，读取快照不得出现新贡献或被替换的证据；恢复开关的结果以工作台确认值为准。当前端点未到，这一步只有本地 Sample 开关验证，不能声称真实提取器已停。

## Sample 演练材料

输入是 [fixtures/learning/console.json](../../fixtures/learning/console.json) 中的合成贡献。`empty` / `candidate` / `learned` 三阶段是明确的 Sample 状态；其中 `learned` 另有较早的独立 Sample 对话，绝非把本次闲聊复制到 intent 凑两源。

控制台使用 `?learningStage=candidate` 或 `?learningStage=learned` 载入对应 Sample 阶段；暂停、撤销只作用于页面内存。进入真实模式不会自动换成 Sample，缺端点会显示尚未提供学习接口。

| 材料 | 状态 |
| --- | --- |
| [空状态](learning-empty.png)、[候选](learning-candidate.png)、[已上卡](learning-learned.png)、[暂停](learning-paused.png) | Chrome 实际渲染的 Sample 截图，未请求商家或运行提取器 |
| rules 独立来源/衰减/撤销/格式往返 | 针对性测试通过，见下方验证记录 |
| memory-repo 意图摘要、Git author/commit、检索与无原文 | 24 项真实临时 Git 测试通过 |
| B 实际模型提取日志 | 待 B learn 与 A 端点；没有用 fixture 代替 |
| 真实报价排序截图 | 待 B 排序与 A 端点；没有编造报价或名次 |

## 性质检查

[learning-properties.ts](../../tests/acceptance/learning-properties.ts) 只处理 HTTP 响应/人工提供的实际观察，不读取工作台、SDK、SQLite 或记忆库。覆盖同源重复、双源晋升、≤200 Unicode 字符证据、暂停前后变化、撤销和受控候选集排序。预算、商家数量、尺码说明继续使用已有 [properties.ts](../../tests/acceptance/properties.ts)。所有断言使用该次响应的 ID 和约束，不固定店名、商品、尺码或价格。

`learning-http.test.ts` 是显式开启的 HTTP 观察用例。当前学习端点 404，因此默认标 skipped；启用后遇 404 或没有实际对话数据会失败，不能把未接线算绿。该用例需要 A 返回可核验的贡献 basis、来源及 card 状态；B 当前仅含 confirmed 的提案不能单独证明晋升。C 不重复 A 的 P0 套件。

## 验证记录

- `tests/acceptance`：5 项新学习性质检查先失败后实现通过；连同 4 项已有性质检查共 9 passed，1 项真实学习 HTTP 用例 skipped；类型检查通过。
- `packages/rules`：47 passed，类型检查通过；既有 27 项保留。`packages/memory-repo`：24 passed，类型检查通过；真实 Git 覆盖提交、作者、摘要投影、重开与 reset。`apps/console`：32 passed，类型检查及 Vite 生产构建通过。
- 浏览器实际操作：空 → 一次闲聊（两候选，无 pref 上卡）→ 独立来源确认（四贡献、两个 pref 上卡）→ 暂停（开关已暂停且已有记录保留）→ 撤销一条徒步贡献（另一条退回候选，卡移除徒步、保留防水）。暂停失败保持旧状态由控制器测试验证，不声称浏览器进行了故障注入。
- 独立审查发现并修复了来源别名重复计数与验收缺失 basis/未来时间校验；回归先失败再通过。队列的 C20 保持未勾选，直到真实对话与排序证据齐全。
- PR CI 发现共享 SDK 桥接签名把旧撤销方法的 string 参数扩宽成学习对象联合类型；已按方法分别声明签名并保留 SDK 实例调用上下文，新增上下文类型推断回归先失败再通过。
