# B 通用商品原话入口验证

A 基线 b824139；B 合入 96fba79。SDK {text,query?,public?}、MCP request 映射、Photon 整句和条件提取、sizeNote 原样显示已完成。

Node22：SDK/MCP/Photon/workspace-fake 的 typecheck、build 全通过；测试分别 73/10/55/6，共144。stdio→SDK→HTTP→A SQLite→C rules/Git memory 的隔离测试验证三种需求，商品目录使用显式合成桩；无真实下单。已有真实 D 录制测试仍通过。

边界：正式 UCP fixture 仍是静态鞋类录制，不按 query 匹配；Photon 加明确录制/非实时/可能不对应需求说明。A 尺码说明暂主要针对数字鞋码，外套 M 码没有凭空补 sizeNote。当前运行的4310及手机监听未切换，不算新入口实机通过。

本轮不更改凭据、Photon cursor/outbox 或演示数据库，不要求重复旧手机验收。
