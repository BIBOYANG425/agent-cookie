# C 线新增包：接口合入前的准备

2026-10-17 用户追加授权：C 线负责 `packages/rules` 与 `packages/memory-repo`，原 console、blueprint、skill、fixtures、acceptance 职责保留。先等 A 的接口类型合入，再实现 rules，之后实现 memory-repo。本记录不修改计划或定义新接口。

本次 fetch 后：`origin/lane-a=17ea049`，已有 core 类型和纯函数，但不存在 `RulesApi` / `MemoryRepoApi`；`origin/main=d48e263` 尚无 packages，当前 lane-c 也无契约包。未自行复制类型、创建猜测接口或合并 A 分支。接口包的实际导入路径及根 workspace 接线由 A 交付。

## rules：每个函数三个 vitest 用例组

以下是行为测试准备，不是已写或已通过的测试；入参、返回和文本编码以即将合入的接口为准。

| 函数 | 用例 1 | 用例 2 | 用例 3 |
| --- | --- | --- | --- |
| mergeCard | 两个独立来源一致上卡；同一来源重复不凑数；personal stated 单源 medium；inferred 不上卡 | 新旧合格值、单源变化与第二源确认；撤销后重算；所有输入排列一致 | 显式 now；恰好 180 / 365 天与超过阈值的衰减/掉卡；重复计算不依赖系统时钟 |
| deriveSessionId | 独立计算的 HMAC/base32 固定向量，精确匹配 8 字符结果 | 同 userSecret 与稳定 merchantKey 跨重注册/重置相同 | 改 userSecret 或 merchantKey 的固定对照向量；空参数按冻结规则处理，不把样本不同宣传为绝无碰撞 |
| renderCard | 所有卡字段与来源、置信度、时间、变化状态完整呈现 | 空卡及候选/历史的冻结输出格式 | 中文、标点、空白与换行在冻结文本格式中可无损表达；同输入同输出 |
| renderContribution | 完整记录及可选 revokedAt 经 renderer/parser 往返相等 | 中文、换行、CRLF、反斜杠、括号、百分号、分号、首尾空白、空值往返相等 | 单条逻辑记录只占一条物理行，不能注入伪记录或元数据 |
| parseContributions | 独立手写的合法文件恢复所有记录、顺序与可选字段 | 多记录和外部绑定的 user/agent 来源符合接口，不相信正文自报身份 | 头部、空行、坏行、重复属性的处理符合冻结规则；不能静默改变合法数据 |

需由契约确定：personal 来源识别方式；单源新值和 personal stated 的全序优先级；changedRecently 清除条件与两个时间字段的语义；衰减后的返回位置；base32 字母表、大小写、字符串编码；renderer/parser 的身份绑定与转义。若 renderCard 没有公开逆解析接口，用冻结的文本 fixture 检查内容，不自行新增 parseCard 契约。

## 已复现的旧实现问题

只读目标为 A 的 `17ea049`，不是当前 lane-c 的新实现。将该提交的 types.ts / merge.ts 复制到临时目录，用 Node 22 的 stripTypeScriptTypes 只去掉类型后运行；没有修改源逻辑或项目文件。所有记录属于同一 Sample 用户，field 都是 shoe_size，now 为 `2026-10-17T12:00:00Z`，personalAgentIds 只含 `sample-personal`。

| 记录 | 来源 | basis | value | createdAt |
| --- | --- | --- | --- | --- |
| p | sample-personal | stated | 43 | 2026-10-14T12:00:00Z |
| q1 | Sample 店 A | observed | 44 | 2026-10-15T12:00:00Z |
| q2 | Sample 店 B | observed | 44 | 2026-10-16T12:00:00Z |
| s | Sample 店 C | observed | 45 | 2026-10-17T11:00:00Z |

实际输出：`[p,q1,q2,s] → 45`，`[q1,q2,s,p] → 43`，`[p,s,q1,q2] → 44`。比较器出现循环：personal 压单商家，新双源压旧 personal，更新单商家又压双源。新包必须用冻结后的明确规则消除顺序依赖，不能照搬此比较器。

另两个源码可直接确认的问题：renderValue 将换行改为空格，不能满足任意字符串往返无损；contributionsFileName 将不允许字符替换为下划线，`a:b` 和 `a_b` 都落到 `a_b.md`，不满足写入者分文件隔离。新的编码/合法输入域须在契约中明确。

## memory-repo：接口与真实 git 测试边界

只在工作台服务端调用这个包。控制台、blueprint、SDK 和验收不得借新目录授权绕过工作台直接读用户记忆库。单元/集成验证使用临时 git 仓库，不对现有用户仓库执行 reset。

待冻结的内容：MemoryRepoApi 的构造/打开方式、方法签名、错误和返回；可信 writer 与 payload signature 的传入位置；CARD 重算和 contribution 写入是一笔还是两笔提交；撤销记录如何物化以及哪层负责；note 完整 UTF-8 文件 2048 字节限制和读写续期责任；固定 seed commit 的建立、识别及 reset 允许范围。不能用 Git author 冒充 payload 签名，也不伪造 Agent-Cookie-Sig。

实施后用真实 simple-git 验证追加不改旧字节、writer/session 路径无碰撞且不越界、commit author/trailer 正确、一次写入的提交数量、并发与失败不混入其他写入、中文 note 的 2047/2048/2049 字节边界、CARD 由 rules 生成，以及 reset 只恢复指定 demo 记忆库的固定 fixtures 初始 commit。A22 所需 userSecret/merchantKey 由工作台种子契约保留，存储包不自行生成新身份。

接口合入后先写 rules 的失败用例，再实现并跑完包级测试；rules 通过后才开始 memory-repo。当前两个新包都尚未创建，没有功能或测试通过结论。
