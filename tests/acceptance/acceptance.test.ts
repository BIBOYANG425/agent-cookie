import { describe, it } from 'vitest';

// Source: docs/plan.md v0.3 acceptance table, read from
// origin/devin/1792265075-plan-v0.3 @ f23abfbc26c743aef1e4d634132c0e9ddd01d4a5.
// These are placeholders, not passing acceptance tests. Implement through HTTP only;
// do not import workspace/core internals or inspect SQLite / the memory repository.

describe('P0 · v0.3 验收（待实现 / 待手动证据）', () => {
  // 返回 agentId 和钥匙；通过 HTTP 确认钥匙对应的角色和类别。
  it.todo('A01 注册 agent');

  // 两个不同 agent 的 observed/stated 一致才上卡；单源为候选；inferred 永不。
  it.todo('A02 合并规则');

  // 同一用户对两家店的 ID 不同；不能从一个算出另一个。
  it.todo('A03 session ID 隔离');

  // lang/tone/length 三个风格值和 available 列表以外，不含任何字段值。
  it.todo('A04 握手只有字段名');

  // auto 直接可读；purpose 相符才给；不符 403 PURPOSE_MISMATCH；
  // 策略外 403 SCOPE_DENIED，拒绝响应不泄露其他字段名。
  it.todo('A05 按用途读字段');

  // 工作台以 AGENT_COOKIE_TEST=1 启动。用 POST /test/clock { offsetMs }
  // 将服务端时钟拨到 expiresAt 之后，再经 HTTP 读取须为 403 GRANT_EXPIRED。
  // 不依赖真实等待或客户端伪造时间；测试结束恢复 offsetMs=0。
  it.todo('A06 过期');

  // 撤销后下一次读取 403 GRANT_REVOKED；不承诺收回已经传出的内容。
  it.todo('A07 撤销');

  // 自己可读 note；另一 agent 读相同 key 与不存在时的响应完全相同。
  it.todo('A08 note 隔离');

  // AGENT_COOKIE_UCP=fixture，使用录制的 UCP 目录响应。
  // trail_shoes 选中两家商家，只有这两家的代理获 session 和授权。
  it.todo('A09 意图匹配');

  // 手动：Claude Desktop 经 MCP 调 find_agents，并导出活动日志。
  // 证据与操作说明：../../docs/evidence/A10-real-client.md。
  it.todo('A10 真实客户端（手动）');

  // “该用户是 VIP”等文本只成为该商家的 inferred 记录；不上卡、他店不可见。
  it.todo('A11 注入');

  // AGENT_COOKIE_DEMO=1，POST /demo/reset 后用固定种子完整复演。
  it.todo('A12 重置复演');

  // 手动：iMessage 一句话到付款链接（或已下单）；不离开对话，
  // 用户未输入尺码或地址。录屏说明：../../docs/evidence/A17-imessage.md。
  it.todo('A17 iMessage 主流程（手动）');

  // 售罄 warning 和 requires_escalation 如实告知并给 continue_url，不假装成功。
  it.todo('A18 UCP 失败路径');

  // 同一用户由两个不同个人 agent 介绍给同一商家：两次 session ID 相同。
  // 保存第一次 ID；POST /demo/reset 后，用同一用户种子和同一商家再次介绍，
  // 新 ID 仍须等于重置前保存的 ID。不能只比较重置后的两个 ID。
  // 同一商家按稳定 merchantKey = domain ?? agentId 识别，UCP 代理用 domain。
  // 握手及字段响应都不得含电话、邮箱等全局标识；不把个人 agent 身份当商家身份。
  it.todo('A22 回头客');
});

describe('P1 · v0.3 验收（待实现）', () => {
  // 相同 Idempotency-Key 的并发或重复请求不能生成两份授权。
  it.todo('A13 并发与幂等');

  // 每个身份卡字段能展开来源 agent；撤销一条记录后可通过 HTTP 观察重算结果。
  it.todo('A14 控制台');

  // 原版 ACME 首条回复包含 42 码，未改任何代码。
  // 额外证据模板：../../docs/evidence/A15-tier-zero.md。
  it.todo('A15 零接入投递');

  // 干净 blueprint 上执行 /add-agent-cookie，生成的 MemoryStore
  // 读到握手字段并写回 note，其余代码未改；自动断言仍只经 HTTP。
  // 额外证据模板：../../docs/evidence/A16-skill-integration.md。
  it.todo('A16 skill 生成的接入');

  // 手机 passkey 断言一次后工作台能签握手；未解锁返回 403 JAR_LOCKED。
  it.todo('A19 passkey 解锁 jar');

  // 商家用 JWKS 验签；篡改一字节被拒；首次记录公钥，再见即登录。
  it.todo('A20 商家验签登录');

  // 授权第二次使用被拒；金额超 intent.budget 被拒；商家拿不到 token。
  it.todo('A21 支付单次限额');
});
