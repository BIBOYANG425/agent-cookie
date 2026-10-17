import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import agents from '../../../fixtures/agents.json';
import contributions from '../../../fixtures/contributions.json';
import './style.css';

const labels: Record<string, string> = {
  lang: '语言', tone: '说话方式', shoe_size: '鞋码',
};

function App() {
  return (
    <>
      <a className="skip-link" href="#card">跳到身份卡</a>
      <header className="masthead">
        <a className="brand" href="#card" aria-label="Agent Cookie 首页">
          <span className="brand-mark" aria-hidden="true">ac</span>
          Agent Cookie
        </a>
        <span className="sample-badge">Sample 样例预览</span>
      </header>
      <main id="card">
        <div className="intro">
          <div>
            <p className="context">你的 agent，从这里认识你</p>
            <h1>身份卡</h1>
          </div>
          <p className="intro-note">每条信息都有来处。<br />展开一项，查看谁记录了它。</p>
        </div>

        <aside className="sample-notice">
          <strong>Sample</strong>
          <p>以下为演示用的贡献记录，尚未连接工作台。合并后的身份卡、授权与活动将在连接后显示。</p>
        </aside>

        <section className="identity-sheet" aria-label="Sample 贡献记录">
          <div className="sheet-heading"><h2>已记录的信息</h2><span>来源可展开</span></div>
          {contributions.map((record) => {
            const source = agents.find((agent) => agent.agentId === record.agentId);
            return (
              <details className="field-row" key={record.id}>
                <summary>
                  <span className="field-name">{labels[record.field] ?? record.field}</span>
                  <span className="field-value">{record.value}</span>
                  <span className="source-toggle">查看来源 <span aria-hidden="true">＋</span></span>
                </summary>
                <div className="source-detail">
                  <p className="source-name">{source?.name ?? record.agentId}</p>
                  <dl>
                    <div><dt>记录依据</dt><dd>用户陈述（{record.basis}）</dd></div>
                    <div><dt>记录时间</dt><dd><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString('zh-CN', { timeZone: 'America/Los_Angeles', hour12: false })}（洛杉矶）</time></dd></div>
                    <div><dt>记录 ID</dt><dd>{record.id}</dd></div>
                  </dl>
                  <p className="source-note">连接工作台后，可以撤销这条来源记录。</p>
                </div>
              </details>
            );
          })}
        </section>
        <footer className="page-footer">
          <span>Sample 数据 · 不代表真实用户</span>
          <span>身份信息由 agent 记录，工作台按规则合并。</span>
        </footer>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
