import { z } from 'zod';
import { getExtractorDefaults, getClassifierModel } from './models.js';
import type { EvidenceModels } from '@agent-cookie/contract';

export type LearningSource = 'photon' | 'mcp' | 'claude-code';
export interface LearningTurn {
  text: string; messageId: string; conversationId: string; occurredAt: string;
  source: LearningSource; speaker: 'owner' | 'other' | 'assistant' | 'merchant'; isGroup: boolean;
}
export type PreferencePolicy = Readonly<Record<string, { description: string; maxLength?: number }>>;
export interface ExtractedPreference { key: string; value: string; evidence: string; basis: 'stated' | 'observed' | 'inferred' }
export interface Classification { stable: boolean; sensitive: boolean; keys: string[] }
export type ModelInput = { text: string; policy: PreferencePolicy; signal: AbortSignal };
export type LearningReason = 'learned' | 'ineligible' | 'sensitive' | 'untrusted_text' | 'not_stable' | 'disabled' | 'invalid_output' | 'unavailable';
export interface LearnResult { preferences: ExtractedPreference[]; reason: LearningReason; models?: EvidenceModels }
export type LearningMetric = { stage: 'filter' | 'classify' | 'extract'; status: 'ok' | 'dropped' | 'unavailable'; count: number; durationMs: number };
export type Telemetry = (metric: LearningMetric) => void;
export const characters = (s: string) => Array.from(s).length;

// Conservative bilingual deny rules; false negatives require the model's separate
// sensitivity verdict too. Unknown languages/ambiguous model results fail closed.
const sensitive = /健康|生病|哮喘|过敏|药|病|抑郁|焦虑|怀孕|血压|医院|宗教|信仰|基督|佛|伊斯兰|清真|祈祷|教会|工资|收入|存款|负债|债务|贷款|信用卡|银行|财务|投资|股票|预算|美元|人民币|[¥$€£]|关系|伴侣|恋爱|分手|男朋友|女朋友|妻子|丈夫|老公|老婆|家人|父母|朋友|行踪|地址|住在|居住|定位|出差|通勤路线|几点|在哪|去了|明天去|今晚|\b(?:health|illness|asthma|allerg\w*|medic\w*|disease|diagnos\w*|depress\w*|anxiety|pregnan\w*|hospital|religio\w*|faith|christian|muslim|buddhis\w*|church|pray\w*|salary|income|debt|loan|bank|credit|financ\w*|invest\w*|budget|dollars?|relationship|partner|dating|boyfriend|girlfriend|wife|husband|married|divorc\w*|parents?|friends?|family|location|address|live at|live in|travel\w*|tonight|tomorrow|whereabouts)\b/iu;
const pii = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d\s().-]{7,}\d)|https?:\/\//iu;
export function containsSensitive(text: string): boolean { return sensitive.test(text.normalize('NFKC')) || pii.test(text); }
const untrusted = /[“”「」『』"<>]|他说|她说|他们|转发|引用|商家说|朋友说|忽略.*(?:指令|规则)|系统提示|\b(?:said|says|quoted?|forwarded|ignore.*instructions?|system prompt|pretend|roleplay)\b/iu;
export function explicitStatement(text: string): boolean {
  return /(?:我|本人).{0,8}(?:一直|通常|总是|更|最)?(?:喜欢|偏好|爱穿|爱用|习惯|不穿|不用|避免)|\bI (?:always |usually |generally |really |don't |do not |never )?(?:prefer|like|love|dislike|avoid|wear|use)\b/iu.test(text)
    && !/(?:如果|假如|可能|也许|不确定|今天|这次)|\b(?:if|maybe|perhaps|today|this time|not sure)\b/iu.test(text);
}
export function filterTurn(turn: LearningTurn): LearningReason | undefined {
  if (turn.speaker !== 'owner' || turn.isGroup !== false || !['photon','mcp','claude-code'].includes(turn.source)
    || !turn.messageId || !turn.conversationId || !Number.isFinite(Date.parse(turn.occurredAt))
    || typeof turn.text !== 'string' || !turn.text.trim() || characters(turn.text) > 4000) return 'ineligible';
  if (containsSensitive(turn.text)) return 'sensitive';
  if (untrusted.test(turn.text) || /(?:忘掉|忘记|暂停学习|恢复学习)|\b(?:forget|pause learning|resume learning)\b/iu.test(turn.text)) return 'untrusted_text';
  if (/(?:如果|假如|不确定)|\b(?:if|not sure)\b/iu.test(turn.text)) return 'not_stable';
  return undefined;
}

export const extractionOutputSchema = z.object({
  sensitive: z.boolean(), stable: z.boolean(),
  preferences: z.array(z.object({ key: z.string().min(1).max(100), value: z.string().min(1).max(200),
    evidence: z.string().min(1).refine(v => characters(v) <= 200), basis: z.enum(['stated','observed','inferred']),
  }).strict()).max(5),
}).strict();
const classificationSchema = z.object({ stable: z.boolean(), sensitive: z.boolean(), keys: z.array(z.string()).max(20) }).strict();

/** Deadline wins even if an injected adapter ignores AbortSignal. Late results are discarded. */
export async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  let listener: (() => void) | undefined;
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('LEARNING_UNAVAILABLE');
      return run(controller.signal);
    }), new Promise<never>((_, reject) => {
      listener = () => reject(new Error('LEARNING_UNAVAILABLE'));
      controller.signal.addEventListener('abort', listener, { once: true });
      if (controller.signal.aborted) listener();
    })]);
  } finally {
    clearTimeout(timer); parent?.removeEventListener('abort', abort);
    if (listener) controller.signal.removeEventListener('abort', listener);
    controller.abort();
  }
}

export function createLearner(options: {
  policy: PreferencePolicy; extract: (input: ModelInput) => Promise<unknown>;
  classify?: (input: ModelInput) => Promise<Classification>;
  mode?: 'all' | 'explicit-only'; timeoutMs?: number; telemetry?: Telemetry;
}) {
  const policy = Object.freeze(Object.fromEntries(Object.entries(options.policy)
    .filter(([key,p]) => /^pref\.[a-z_]+$/.test(key) && p.description && !containsSensitive(key + ' ' + p.description))
    .map(([key,p]) => [key, Object.freeze({ description: p.description, maxLength: Math.min(p.maxLength ?? 80, 200) })])));
  const modelDefaults = getExtractorDefaults(options.extract);
  const classify = options.classify ?? modelDefaults?.classify;
  const timeoutMs = options.timeoutMs ?? (modelDefaults ? 30000 : 10000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid learning timeout.');
  const metric = (m: LearningMetric) => { try { options.telemetry?.(m); } catch { /* observers never change learning */ } };
  return {
    async learn(turn: LearningTurn, control: { signal?: AbortSignal } = {}): Promise<LearnResult> {
      const start = performance.now();
      const reject = filterTurn(turn) ?? (!Object.keys(policy).length ? 'disabled' : undefined)
        ?? (options.mode === 'explicit-only' && !explicitStatement(turn.text) ? 'not_stable' : undefined);
      metric({stage:'filter',status:reject ? 'dropped':'ok',count:0,durationMs:performance.now()-start});
      if (reject) return {preferences:[],reason:reject};
      try {
        return await bounded(async signal => {
          let selected = policy;
          let gate: string | undefined;
          if (classify) {
            try {
              const c = classificationSchema.parse(await bounded(s => classify({text:turn.text,policy,signal:s}), Math.min(1500,timeoutMs), signal));
              metric({stage:'classify',status:'ok',count:0,durationMs:performance.now()-start});
              if (c.sensitive || !c.stable) return {preferences:[],reason:c.sensitive?'sensitive':'not_stable'};
              selected = Object.fromEntries(Object.entries(policy).filter(([key]) => c.keys.includes(key)));
              if (!Object.keys(selected).length) return {preferences:[],reason:'not_stable'};
              gate = getClassifierModel(classify);
            } catch {
              // Unavailable Jev falls back to extraction; a successful negative verdict never does.
              metric({stage:'classify',status:'unavailable',count:0,durationMs:performance.now()-start});
              if (signal.aborted) return {preferences:[],reason:'unavailable'};
            }
          }
          const raw = await options.extract({text:turn.text,policy:selected,signal});
          if (signal.aborted) return {preferences:[],reason:'unavailable'};
          const parsed = extractionOutputSchema.safeParse(raw);
          if (!parsed.success) return {preferences:[],reason:'invalid_output'};
          if (parsed.data.sensitive || !parsed.data.stable) return {preferences:[],reason:parsed.data.sensitive?'sensitive':'not_stable'};
          const seen = new Set<string>();
          const preferences = parsed.data.preferences.filter(p => {
            if (!Object.hasOwn(selected,p.key) || seen.has(p.key) || !p.value.trim() || !p.evidence.trim()
              || characters(p.value) > (selected[p.key].maxLength ?? 80) || !turn.text.includes(p.evidence)
              || containsSensitive(p.value + ' ' + p.evidence) || untrusted.test(p.value)
              || (p.basis === 'stated' && !explicitStatement(p.evidence))
              || (options.mode === 'explicit-only' && p.basis !== 'stated')) return false;
            seen.add(p.key); return true;
          });
          metric({stage:'extract',status:'ok',count:preferences.length,durationMs:performance.now()-start});
          // Only successful, known adapters supply provenance. A failed Jev
          // request followed by extraction must not claim a gate decision.
          const models = {...(gate ? {gate} : {}), ...(modelDefaults ? {extractor:modelDefaults.model} : {})};
          return {preferences,reason:preferences.length?'learned':'invalid_output',
            ...(preferences.length && Object.keys(models).length ? {models} : {})};
        }, timeoutMs, control.signal);
      } catch {
        metric({stage:'extract',status:'unavailable',count:0,durationMs:performance.now()-start});
        return {preferences:[],reason:'unavailable'};
      }
    },
  };
}

export { createExtractor, createHaikuExtractor, createJevClassifier, getExtractorDefaults, DEFAULT_EXTRACTION_MODEL, EXTRACTION_MODELS, JEV_MODEL, HAIKU_MODEL, OPENROUTER_HAIKU_MODEL } from "./models.js";
export { createLearningTelemetry, type PipelineMetric } from './telemetry.js';
export { createWorkspaceLearner, DEFAULT_LEARNING_POLICY } from './workspace.js';
