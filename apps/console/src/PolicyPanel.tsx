import { t, localizeUiText } from './i18n';
import { useState } from 'react';
import type { PolicyResult } from './controller';
import type { Section } from './model';
import { categoryLabels, decisionLabels, POLICY_CATEGORIES, sourceLabels, type PolicyView } from './policy';

const SHOWN_CHANGES = 100;

function FieldList({ fields }: { fields: readonly string[] }) {
  return fields.length === 0 ? <span className="muted">{t("none")}</span>
    : <ul className="policy-fields">{fields.map((field) => <li key={field}><code className="field-key">{field}</code></li>)}</ul>;
}

export function PolicyResultView({ result }: { result?: PolicyResult }) {
  if (!result) return null;
  if (result.kind === 'invalid') return <p className="status-message error policy-result" role="alert">{localizeUiText(result.message)}</p>;
  if (result.kind === 'installed') return <p className="status-message success policy-result" role="status">
    {t("installedPolicy")}<code>{result.policyId}</code>{t("newGrantsAndReceiptsWillRecord")}</p>;
  if (result.kind === 'violations') return <div className="status-message error policy-result" role="alert">
    <p>{result.action === 'install' ? t("theWorkspaceRejectedInstallationTheCurrent") : t("theWorkspaceDidNotRunShadow")}
      {t("theFollowing")}{result.violations.length}{t("itemsNeedChanges")}</p>
    <ul className="policy-violations">{result.violations.map((line, index) => <li key={index}>{line}</li>)}</ul>
  </div>;
  const { report } = result;
  return <div className="policy-result shadow-report">
    <p role="status"><strong>{t("shadowEvaluation")}</strong>{t("candidate")}<code>{report.candidateId}</code>{t("comparedWithCurrent")}<code>{report.currentId}</code>
      {report.candidateId === report.currentId ? t("identicalDocuments") : ''}：{report.changed.length}{t("decisionsWouldChange")}{report.unchanged}{t("wouldNotOnlyPastReceiptsAnd")}</p>
    {report.changed.length > 0 && <>
      <p className="small muted">{t("receiptReleasedAccessReceiptReadField")}{Object.entries(decisionLabels)
        .map(([code, label]) => `${code} = ${label}`).join('，')}。</p>
      <ol className="shadow-list">{report.changed.slice(0, SHOWN_CHANGES).map((row, index) => <li key={index}>
        <code>{row.ref}</code> · {row.kind} · <code>{row.field}</code>: {row.before} → {row.after}</li>)}</ol>
      {report.changed.length > SHOWN_CHANGES && <p className="small muted">{t("showingTheFirst")}{SHOWN_CHANGES}{t("of")}{report.changed.length}{t("records")}</p>}
    </>}
  </div>;
}

export function PolicyPanel({ state, sample, result, disabled, shadow, install }: {
  state?: Section<PolicyView>; sample: boolean; result?: PolicyResult; disabled: boolean;
  shadow: (text: string) => void; install: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const view = state?.availability === 'ready' ? state.data : undefined;
  const labelled = sample || (state?.availability === 'ready' && state.sample === true);
  const submit = !disabled && !sample && !!view;
  return <section id="policy" className="panel" aria-labelledby="policy-title">
    <div className="sheet-heading"><h2 id="policy-title" tabIndex={-1}>{t("policy")}</h2>
      <span>{labelled ? t("samplePurposeBasedAccessDeterministicChecks") : t("purposeBasedAccessDeterministicChecks")}</span></div>
    {!state ? <p className="empty">{t("connectToViewTheCurrentField")}</p>
      : !view ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : <>
        <dl className="policy-meta">
          <div><dt>{t("policyId")}</dt><dd><code>{view.policyId}</code>{sample ? t("samplePlaceholderNotAHash") : ''}</dd></div>
          <div><dt>{t("source")}</dt><dd>{sourceLabels[view.source].label}（{view.source}）<span className="policy-source-note">{sourceLabels[view.source].note}</span></dd></div>
          <div><dt>{t("rankingWeights")}</dt><dd>{view.policy.ranking
            ? <>winRate {view.policy.ranking.winRate} · failure {view.policy.ranking.failure}
              {view.policy.ranking.winRate === 0 && view.policy.ranking.failure === 0 ? t("bothEquivalentToUnset") : ''}</>
            : t("notSetRankByRequestedMerchant")}</dd></div>
        </dl>
        <table className="policy-table stack-table">
          <caption className="visually-hidden">{t("fieldPolicyPerCategoryAutomaticBy")}</caption>
          <thead><tr><th scope="col">{t("category")}</th><th scope="col">{t("automaticReadableOnHandshake")}</th><th scope="col">{t("byPurpose")}</th><th scope="col">{t("writable")}</th></tr></thead>
          <tbody>{POLICY_CATEGORIES.map((category) => {
            const purposes = Object.entries(view.policy.purpose[category] ?? {});
            return <tr key={category}>
              <th scope="row">{categoryLabels[category]} <code className="field-key">{category}</code></th>
              <td data-label={t("automatic")}><FieldList fields={view.policy.auto[category] ?? []} /></td>
              <td data-label={t("byPurpose")}>{purposes.length === 0 ? <span className="muted">{t("none")}</span>
                : <ul className="policy-purposes">{purposes.map(([field, list]) => <li key={field}>
                  <code className="field-key">{field}</code>{t("onlyFor")}{(list ?? []).map((name, index) => <span key={name}>{index > 0 ? '、' : ''}<code>{name}</code></span>)}</li>)}</ul>}</td>
              <td data-label={t("writable")}><FieldList fields={view.policy.write[category] ?? []} /></td>
            </tr>;
          })}</tbody>
        </table>
      </>}
    <div className="policy-candidate">
      <h3>{t("candidatePolicy")}</h3>
      <p id="policy-candidate-note" className="small muted">{t("pasteAJsonPolicyDocumentShadow")}{sample ? t("sampleModeNeitherEvaluatesNorInstalls") : ''}</p>
      <label htmlFor="policy-candidate-input">{t("candidatePolicyDocumentJson")}</label>
      <textarea id="policy-candidate-input" value={text} rows={8} spellCheck={false} autoComplete="off"
        aria-describedby="policy-candidate-note" onChange={(event) => setText(event.target.value)} />
      <div className="policy-actions">
        <button type="button" disabled={!view} onClick={() => { if (view) setText(JSON.stringify(view.policy, null, 2)); }}>{t("fillCurrentDocument")}</button>
        <button type="button" disabled={!submit} onClick={() => shadow(text)}>{t("shadowEvaluation")}</button>
        <button type="button" className="primary" disabled={!submit} onClick={() => install(text)}>{t("install")}</button>
      </div>
      <PolicyResultView result={result} />
    </div>
  </section>;
}
