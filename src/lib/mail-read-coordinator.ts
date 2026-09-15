/** A tab-local, bounded read queue. No credentials, persistent storage or writes. */
export class MailReadCoordinator {
  private values = new Map<string, { value: unknown; at: number; generation: number }>();
  private pending = new Map<string, Promise<unknown>>();
  private generations = new Map<string, number>();
  private versions = new Map<string, number>();
  private active = new Map<string, number>();
  private running = new Map<string, number[]>();
  private queues = new Map<string, Array<{ resource: string; priority: number; at: number; run: () => void }>>();
  private cooling = new Map<string, number>();
  constructor(private now = () => Date.now(), private concurrency = 3, private capacity = 300) {}
  private key(scope: string, resource: string) { return JSON.stringify([scope, resource]); }
  peek<T>(scope: string, resource: string, ttl = 60_000): T | undefined {
    const entry = this.values.get(this.key(scope, resource));
    return entry && entry.generation === (this.generations.get(scope) || 0)
      && this.now() - entry.at < ttl ? entry.value as T : undefined;
  }
  entries<T>(scope: string): Array<[string, T]> {
    return [...this.values].flatMap(([key, entry]) => {
      const [owner, resource] = JSON.parse(key) as [string, string];
      return owner === scope ? [[resource, entry.value as T] as [string, T]] : [];
    });
  }
  seed<T>(scope: string, resource: string, value: T) {
    const key = this.key(scope, resource);
    this.values.delete(key);
    this.values.set(key, { value, at: this.now(), generation: this.generations.get(scope) || 0 });
    while (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value!);
  }
  forget(scope: string, resource: string) {
    const key = this.key(scope, resource);
    this.values.delete(key);
    this.versions.set(key, (this.versions.get(key) || 0) + 1);
  }
  invalidate(scope: string) {
    this.generations.set(scope, (this.generations.get(scope) || 0) + 1);
    for (const key of this.values.keys()) if (JSON.parse(key)[0] === scope) this.values.delete(key);
  }
  clear() {
    for (const scope of new Set([...this.generations.keys(), ...this.active.keys(), ...this.queues.keys()])) this.invalidate(scope);
    this.values.clear();
  }
  cooldown(scope: string, ms: number) { this.cooling.set(scope, this.now() + ms); }
  promote(scope: string, resource: string, priority = 0) {
    for (const task of this.queues.get(scope) || []) {
      if (task.resource === resource) task.priority = Math.min(task.priority, priority);
    }
    this.pump(scope);
  }
  private pump(scope: string) {
    const queue = this.queues.get(scope) || [];
    // Age background work within the non-interactive lane so it cannot starve.
    const rank = (task: typeof queue[number]) => task.priority > 0 && this.now() - task.at >= 5_000 ? 1 : task.priority;
    queue.sort((a, b) => rank(a) - rank(b) || a.at - b.at);
    while (queue.length && (this.active.get(scope) || 0) < this.concurrency) {
      const running = this.running.get(scope) || [];
      const index = queue.findIndex((task) => {
        if (this.concurrency === 1) return true;
        if (task.priority === 0) return !queue.some((item) => item.priority > 0)
          || running.filter((priority) => priority === 0).length < this.concurrency - 1;
        // Reserve one position for clicks; prefetch alone may occupy only one.
        return running.filter((priority) => priority > 0).length < this.concurrency - 1
          && (task.priority < 2 || !running.includes(2));
      });
      if (index < 0) break;
      const task = queue.splice(index, 1)[0];
      this.active.set(scope, (this.active.get(scope) || 0) + 1);
      running.push(task.priority);
      this.running.set(scope, running);
      task.run();
    }
  }
  load<T>(scope: string, resource: string, loader: () => Promise<T>, options: {
    force?: boolean; priority?: number; ttl?: number; queueTimeoutMs?: number; cache?: (value: T) => boolean;
  } = {}): Promise<T> {
    if (!options.force) {
      const cached = this.peek<T>(scope, resource, options.ttl);
      if (cached !== undefined) return Promise.resolve(cached);
    }
    const generation = this.generations.get(scope) || 0;
    this.generations.set(scope, generation);
    const versionKey = this.key(scope, resource);
    const resourceVersion = this.versions.get(versionKey) || 0;
    const key = this.key(scope, `${generation}:${resourceVersion}:${resource}`);
    const existing = this.pending.get(key);
    if (existing) {
      this.promote(scope, resource, options.priority ?? 1);
      return existing as Promise<T>;
    }
    const request = new Promise<T>((resolve, reject) => {
      const task = { resource, priority: options.priority ?? 1, at: this.now(), run: () => {
        clearTimeout(timer);
        const runningPriority = task.priority;
        Promise.resolve().then(() => {
          if ((this.generations.get(scope) || 0) !== generation || (this.versions.get(versionKey) || 0) !== resourceVersion) throw new Error('邮箱状态已变化，请重新读取。');
          const delay = (this.cooling.get(scope) || 0) - this.now();
          if (delay > 0) throw new Error(`邮箱读取暂时受限，请约 ${Math.ceil(delay / 1000)} 秒后重试。`);
          return loader();
        }).then((value) => {
          if ((this.generations.get(scope) || 0) !== generation || (this.versions.get(versionKey) || 0) !== resourceVersion) throw new Error('邮箱状态已变化，请重新读取。');
          if (!options.cache || options.cache(value)) this.seed(scope, resource, value);
          resolve(value);
        }).catch(reject).finally(() => {
          const running = this.running.get(scope) || [];
          running.splice(running.indexOf(runningPriority), 1);
          this.active.set(scope, (this.active.get(scope) || 1) - 1);
          this.pump(scope);
        });
      } };
      const queue = this.queues.get(scope) || [];
      queue.push(task);
      this.queues.set(scope, queue);
      const timer = setTimeout(() => {
        const index = queue.indexOf(task);
        if (index < 0) return;
        queue.splice(index, 1);
        reject(new Error('邮箱读取排队超时，请稍后重试。'));
        this.pump(scope);
      }, options.queueTimeoutMs ?? 60_000);
      this.pump(scope);
    });
    this.pending.set(key, request);
    void request.finally(() => { if (this.pending.get(key) === request) this.pending.delete(key); }).catch(() => undefined);
    return request;
  }
}
