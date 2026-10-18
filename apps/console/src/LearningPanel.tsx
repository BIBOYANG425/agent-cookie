import { t, dateLocale, localizeUiText } from './i18n';
import { FieldName, fieldName } from './fields';
import { countEvidenceSources, type LearningState } from './learning';

const time = (at: string) => new Date(at).toLocaleString(dateLocale(), { hour12: false });
const basis = { get stated() { return t("userStated"); }, get observed() { return t("observed"); }, get inferred() { return t("inferred"); } };

export function LearningToggle({ state, disabled, change }: {
  state?: LearningState; disabled: boolean; change: (paused: boolean) => void;
}) {
  const ready = state?.availability === 'ready' && state.paused !== null;
  return <button type="button" className="learning-toggle" role="switch" aria-label={t("pauseLearning")}
    aria-checked={ready && state.paused === true} disabled={disabled || !ready}
    aria-describedby="learning-toggle-note" onClick={() => { if (ready) change(!state.paused); }}>
    <span className="switch-track" aria-hidden="true"><span /></span>{t("pauseLearning116")}<span className="small">{!ready ? t("statusUnconfirmed") : state.paused ? t("paused") : t("notPaused")}</span>
  </button>;
}

export function LearningPanel({ state, sample, disabled, revoke, selectStage }: {
  state?: LearningState; sample: boolean; disabled: boolean;
  revoke: (contributionId: string) => void; selectStage?: (id: string) => void;
}) {
  return <section id="learned" className="panel" aria-labelledby="learned-title">
    <div className="sheet-heading"><h2 id="learned-title" tabIndex={-1}>{t("learned")}</h2>
      <span>{sample ? t("sampleLearningStateDemo") : t("recordsSourcesAndEvidence")}</span></div>
    <p id="learning-toggle-note" className="panel-note">{state?.availability === 'ready'
      ? state.paused ? t("learningIsPausedExistingRecordsRemain") : t("learningIsEnabledPauseAtThe")
      : t("learningStatusIsUnconfirmedAndCannot")}</p>
    {sample && state?.sampleStages && <div className="learning-replay">
      <p>{t("sampleStagedDemoNoExtractorOr")}</p>
      <div className="replay-actions">{state.sampleStages.map((stage) => <button type="button" key={stage.id}
        aria-pressed={state.sampleStage === stage.id} disabled={disabled || !selectStage}
        onClick={() => selectStage?.(stage.id)}>{localizeUiText(stage.label)}</button>)}</div>
      {state.sampleDescription && <p className="sample-description">{localizeUiText(state.sampleDescription)}</p>}
    </div>}
    {!state ? <p className="empty">{t("connectToLoadLearningStatus")}</p>
      : state.availability !== 'ready' ? <p className="empty" role={state.availability === 'error' ? 'status' : undefined}>{state.message}</p>
      : state.entries.length === 0 ? <p className="empty">{t("nothingLearnedYetChatWithYour")}</p>
      : <ol className="learned-list">{state.entries.map((entry) => <li key={JSON.stringify([entry.field, entry.value])} className="learned-record">
        <div className="learned-heading"><div><h3><FieldName field={entry.field} /></h3><p className="learned-value">{entry.value || t("empty")}</p></div>
          <span className={`learned-status ${entry.status}`}>{entry.status === 'card' ? t("onTheCard") : t("candidateNotOnCard")}</span></div>
        <p className="small">{t("sourceAgents")}{entry.sources.length ? entry.sources.join('、') : t("notProvidedYet")}</p>
        <details className="learned-sources" open><summary>{entry.evidence.length === 0 ? t("sourcesAndEvidenceNotProvidedYet")
          : <>{t("sourcesAndEvidence")}{entry.evidence.length}{t("contributions")}{countEvidenceSources(entry.evidence)}{t("sources")}</>}</summary>
          <p className="source-note">{sample ? t("sampleIllustrationCardStatusComesFrom")
            : t("cardStatusComesFromTheWorkspace")}</p>
          {entry.evidence.length === 0 ? <p className="source-note">{t("theWorkspaceHasNotProvidedContribution")}</p>
            : entry.evidence.map((evidence) => <article className="source-record" key={evidence.contributionId}>
              <h3>{evidence.agentId}</h3>
              {evidence.snippet && <blockquote className="learned-evidence">{evidence.snippet}</blockquote>}
              <dl><div><dt>{t("recordBasis")}</dt><dd>{basis[evidence.basis]}（{evidence.basis}）</dd></div>
                <div><dt>{t("modelSource")}</dt><dd>{[evidence.models?.gate, evidence.models?.extractor].filter(Boolean).join(' → ') || t("localRules")}</dd></div>
                <div><dt>{t("recordedAt")}</dt><dd><time dateTime={evidence.createdAt}>{time(evidence.createdAt)}</time></dd></div>
                {evidence.conversationId && <div><dt>{t("conversation")}</dt><dd><code>{evidence.conversationId}</code></dd></div>}
                {evidence.intentId && <div><dt>{t("intent")}</dt><dd><code>{evidence.intentId}</code></dd></div>}
                {!evidence.conversationId && !evidence.intentId && <div><dt>{t("sourceIdentifier")}</dt><dd>{t("noConversationOrIntentIdProvided")}</dd></div>}
                <div><dt>{t("contributionId")}</dt><dd><code>{evidence.contributionId}</code></dd></div></dl>
              <button type="button" className="danger" disabled={disabled}
                aria-label={t("revokeLearnedRecord", fieldName(entry.field), evidence.contributionId)}
                onClick={() => revoke(evidence.contributionId)}>{t("revokeThisRecord")}</button>
            </article>)}
        </details>
      </li>)}</ol>}
  </section>;
}
