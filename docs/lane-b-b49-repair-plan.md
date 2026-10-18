# PR20 / B49 收尾计划

人的最新授权：B 处理当前 PR20 与六场景的全部跨线修复。工作基线 lane-b d9aa3ce（Bob 已补根 build:deps），隔离工作树执行；最终推 lane-b，人工合并。原六场景脚本不改。保留正式权限、受信作者绑定及现有演示数据，不做真实模型重试或手机切换。

- [x] 接入 C e094414 的 rules/memory-repo/fixtures 精确树；保留 C 实现归属。
- [x] 契约公开 evidenceSources；保留 stated，按独立证据去重和晋升，接力历史作者取本次执行者。
- [x] 原话改有界内存队列，排队、暂停、重启、拥塞和异常均不得落盘；测试原六场景及边界。
- [x] 单次 forget 请求：阻断在途学习，事务处理当前偏好/证据与防复活标记，Git 投影失败可恢复且不虚报历史物理擦除；补 SDK/Photon 接线与并发/失败测试。
- [x] 将 createWorkspaceLearner 接后台；显式配置模型/遥测，未配置时不发请求，关闭时清理资源。
- [x] 全仓类型检查、测试、控制台构建；原六场景 6/6；锁文件安装验证。
- [x] 推 lane-b 后核验 PR20 的干净 CI（a9fe989，run39083850322 全绿）。
- [ ] 同步 main468e92d 的 Dreaming，并复核新 HEAD CI/可合并状态。

验收边界：真实模型仍有已确认 OpenRouter 403，本轮不靠重复调用解决账号限制。没有实际凭据/服务的 Spectrum 和同店商家模型开场不冒充通过。forget 的 SQLite 状态原子提交与 Git 投影恢复需明确测试；Git 历史物理擦除不是一次普通撤销提交能承诺的能力。

执行中 A9eec478 和 C5de9fc1 发布：已并入同一修复分支，原 six-scenario 断言保留。evidenceSources 用 C 的实际 ID 数组；模型启用只选 OpenRouter，默认 off。
