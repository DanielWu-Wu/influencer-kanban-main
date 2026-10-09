import type { MonitorJob, MonitorProject, MonitorResult, MonitorState, MonitorVideo } from './video-monitor';

// Pool identical snapshots, not just IDs: historical results may reference older metadata.
type PackedState = {
  format: 2; projects: MonitorProject[]; videos: MonitorVideo[]; continueIds: string[]; saveId?: string;
  results: (Omit<MonitorResult, 'project' | 'video'> & { project: number; video: number })[];
  job?: Omit<MonitorJob, 'projects' | 'videos'> & { projects: number[]; videos: number[] };
};
export function packMonitorState(state: MonitorState): PackedState {
  const projects: MonitorProject[] = [], videos: MonitorVideo[] = [];
  const projectKeys = new Map<string, number>(), videoKeys = new Map<string, number>();
  function intern<T>(value: T, values: T[], keys: Map<string, number>) {
    const key = JSON.stringify(value);
    let index = keys.get(key);
    if (index === undefined) { index = values.length; keys.set(key, index); values.push(value); }
    return index;
  }
  const p = (value: MonitorProject) => intern(value, projects, projectKeys);
  const v = (value: MonitorVideo) => intern(value, videos, videoKeys);
  return { format: 2, projects, videos, continueIds: state.continueIds, saveId: state.saveId,
    results: state.results.map(result => ({ ...result, project: p(result.project), video: v(result.video) })),
    job: state.job ? { ...state.job, projects: state.job.projects.map(p), videos: state.job.videos.map(v) } : undefined };
}
export function unpackMonitorState(input: unknown): MonitorState {
  const state = input as PackedState;
  if (!state || !Array.isArray(state.results) || !Array.isArray(state.continueIds)) throw new Error('检测记录格式无效。');
  if (state.format !== 2) return input as MonitorState;
  function get<T>(values: T[], index: number) {
    if (!Number.isInteger(index) || !values?.[index]) throw new Error('检测记录引用无效。');
    return values[index];
  }
  return { results: state.results.map(result => ({ ...result, project: get(state.projects, result.project), video: get(state.videos, result.video) })),
    continueIds: state.continueIds, saveId: state.saveId,
    job: state.job ? { ...state.job, projects: state.job.projects.map(i => get(state.projects, i)), videos: state.job.videos.map(i => get(state.videos, i)) } : undefined };
}

/** Stop later writes after a failed checkpoint; callers must reload/recover before resuming. */
export function monitorSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work);
    tail = next;
    void tail.catch(() => undefined);
    return next;
  };
}
