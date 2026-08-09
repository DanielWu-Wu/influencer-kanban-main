import { extractFeishuEmails } from './feishu-record-index';

export type ProspectEmailSource = 'youtube' | 'resource' | 'development' | 'manual';

export type ProspectEmailCandidateSource = Exclude<ProspectEmailSource, 'manual'>;

export type ProspectEmailCandidate = {
  email: string;
  sources: ProspectEmailCandidateSource[];
};

export type ProspectEmailSelectionState = {
  publicEmail?: string;
  emailStatus?: 'available' | 'manual' | 'missing';
  emailSource?: ProspectEmailSource;
  emailCandidates?: ProspectEmailCandidate[];
  emailManuallyLocked?: boolean;
  emailSelectionRequired?: boolean;
};

type CandidateUpdateOptions = {
  replaceSources?: ProspectEmailCandidateSource[];
};

const SOURCE_ORDER: ProspectEmailCandidateSource[] = ['resource', 'development', 'youtube'];

const SOURCE_LABELS: Record<ProspectEmailCandidateSource, string> = {
  youtube: 'YouTube 简介',
  resource: '飞书资源库',
  development: '历史开发记录',
};

function normalizeCandidateEmail(value: unknown) {
  return extractFeishuEmails(value)[0] || '';
}

function sortSources(sources: Iterable<ProspectEmailCandidateSource>) {
  const sourceSet = new Set(sources);
  return SOURCE_ORDER.filter((source) => sourceSet.has(source));
}

export function normalizeProspectEmailCandidates(
  candidates: ProspectEmailCandidate[] | undefined,
) {
  const byEmail = new Map<string, ProspectEmailCandidate>();
  for (const candidate of candidates || []) {
    const email = normalizeCandidateEmail(candidate.email);
    if (!email) continue;
    const key = email.toLowerCase();
    const existing = byEmail.get(key);
    const sources = sortSources([
      ...(existing?.sources || []),
      ...(candidate.sources || []).filter((source): source is ProspectEmailCandidateSource => (
        source === 'youtube' || source === 'resource' || source === 'development'
      )),
    ]);
    if (!sources.length) continue;
    byEmail.set(key, { email: existing?.email || email, sources });
  }
  return Array.from(byEmail.values());
}

export function buildProspectEmailCandidates(
  value: unknown,
  source: ProspectEmailCandidateSource,
) {
  return extractFeishuEmails(value).map((email) => ({ email, sources: [source] }));
}

export function updateProspectEmailCandidates(
  state: ProspectEmailSelectionState,
  additions: ProspectEmailCandidate[],
  options: CandidateUpdateOptions = {},
): ProspectEmailSelectionState {
  const replaceSources = new Set(options.replaceSources || []);
  const retained = normalizeProspectEmailCandidates(state.emailCandidates)
    .flatMap((candidate) => {
      const sources = candidate.sources.filter((source) => !replaceSources.has(source));
      return sources.length ? [{ ...candidate, sources }] : [];
    });
  const currentEmail = normalizeCandidateEmail(state.publicEmail);
  const currentAutomaticSource = state.emailSource && state.emailSource !== 'manual'
    ? state.emailSource
    : state.emailStatus === 'available'
      ? 'youtube'
      : undefined;
  const currentCandidate = currentEmail
    && currentAutomaticSource
    && !replaceSources.has(currentAutomaticSource)
    ? [{ email: currentEmail, sources: [currentAutomaticSource] } satisfies ProspectEmailCandidate]
    : [];
  const candidates = normalizeProspectEmailCandidates([
    ...retained,
    ...currentCandidate,
    ...additions,
  ]);

  if (state.emailManuallyLocked) {
    return {
      ...state,
      emailCandidates: candidates,
      emailSelectionRequired: false,
    };
  }

  if (candidates.length === 1) {
    const candidate = candidates[0];
    return {
      ...state,
      publicEmail: candidate.email,
      emailStatus: 'available',
      emailSource: candidate.sources[0],
      emailCandidates: candidates,
      emailManuallyLocked: false,
      emailSelectionRequired: false,
    };
  }

  const currentStillAvailable = candidates.some((candidate) => (
    candidate.email.toLowerCase() === currentEmail.toLowerCase()
  ));

  return {
    ...state,
    publicEmail: currentStillAvailable ? state.publicEmail : '',
    emailStatus: currentStillAvailable ? state.emailStatus : 'missing',
    emailSource: currentStillAvailable ? state.emailSource : undefined,
    emailCandidates: candidates,
    emailSelectionRequired: candidates.length > 1,
  };
}

export function applyManualProspectEmail(
  state: ProspectEmailSelectionState,
  value: string,
): ProspectEmailSelectionState {
  return {
    ...state,
    publicEmail: value,
    emailStatus: value.trim() ? 'manual' : 'missing',
    emailSource: 'manual',
    emailManuallyLocked: true,
    emailSelectionRequired: false,
  };
}

export function selectProspectEmailCandidate(
  state: ProspectEmailSelectionState,
  email: string,
): ProspectEmailSelectionState {
  const normalized = normalizeCandidateEmail(email);
  const candidate = normalizeProspectEmailCandidates(state.emailCandidates)
    .find((item) => item.email.toLowerCase() === normalized.toLowerCase());
  if (!candidate) return state;
  return {
    ...state,
    publicEmail: candidate.email,
    emailStatus: 'manual',
    emailSource: candidate.sources[0],
    emailCandidates: normalizeProspectEmailCandidates(state.emailCandidates),
    emailManuallyLocked: true,
    emailSelectionRequired: false,
  };
}

export function prospectEmailSourceLabel(state: ProspectEmailSelectionState) {
  const currentEmail = normalizeCandidateEmail(state.publicEmail);
  const candidate = normalizeProspectEmailCandidates(state.emailCandidates)
    .find((item) => item.email.toLowerCase() === currentEmail.toLowerCase());
  if (state.emailManuallyLocked) {
    if (state.emailSource === 'manual' || !candidate) return '手动填写，系统不会自动覆盖';
    return `已手动选择 · 来自${candidate.sources.map((source) => SOURCE_LABELS[source]).join('、')}`;
  }
  if (candidate) return `来自${candidate.sources.map((source) => SOURCE_LABELS[source]).join('、')}`;
  if (state.emailSource && state.emailSource !== 'manual') return `来自${SOURCE_LABELS[state.emailSource]}`;
  return state.publicEmail?.trim() ? '邮箱已填写' : '';
}

export function prospectEmailSelectionMessage(state: ProspectEmailSelectionState) {
  const candidates = normalizeProspectEmailCandidates(state.emailCandidates);
  const currentKey = normalizeCandidateEmail(state.publicEmail).toLowerCase();
  const alternatives = candidates.filter((candidate) => candidate.email.toLowerCase() !== currentKey);
  if (state.emailSelectionRequired) {
    const tableEmails = candidates.filter((candidate) => (
      candidate.sources.includes('resource') || candidate.sources.includes('development')
    ));
    return tableEmails.length > 1
      ? '表格中有多个邮箱，请选择'
      : '发现不同来源邮箱，请选择';
  }
  if (state.emailManuallyLocked && alternatives.length) {
    return `系统不会覆盖当前邮箱，另有 ${alternatives.length} 个候选邮箱可选`;
  }
  return '';
}

export function hasProspectEmailAlternatives(state: ProspectEmailSelectionState) {
  const currentKey = normalizeCandidateEmail(state.publicEmail).toLowerCase();
  return normalizeProspectEmailCandidates(state.emailCandidates)
    .some((candidate) => candidate.email.toLowerCase() !== currentKey);
}

export function prospectEmailCandidateLabel(candidate: ProspectEmailCandidate) {
  return candidate.sources.map((source) => SOURCE_LABELS[source]).join('、');
}
