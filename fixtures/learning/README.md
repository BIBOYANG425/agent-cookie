# Sample 学习桩

`console.json` 是 C19 控制台的合成数据，不是 B 的模型提取结果。响应结构已对齐 A `0129f08`：`{ paused, learned }`，按字段和值分组，每条 evidence 带真实形状的 contributionId、agentId、basis、createdAt 及来源/短摘句。

- `empty`：无学习条目。
- `candidate`：`pref.material=棉质`、`pref.color=黑色` 各只有一个 Sample 对话来源；不同字段不互相佐证。
- `learned`：另一段独立 Sample 对话对同字段同值给出证据，各晋升 medium。
- 撤销使用 `evidence[].contributionId`；撤销一条佐证后，另一条退回候选。
- 所有证据均为合成片段且 ≤200 Unicode 字符。字段属于 A 的精确白名单，fixture 不改变后台授权策略。

原版徒步/防水 Sample 字段不在 A 当前白名单，已移除。这里的棉质/颜色只验证界面，不能替代 C20 指定闲聊的真实学习、报价排序或截图证据。历史截图的版本与当前证据状态见 [learning.md](../../docs/evidence/learning.md)。
