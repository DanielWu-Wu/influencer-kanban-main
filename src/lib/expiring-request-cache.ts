export class ExpiringRequestCache<T> {
  private readonly values = new Map<string, { value: T; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string) {
    const cached = this.values.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= this.now()) {
      this.values.delete(key);
      return undefined;
    }
    return cached.value;
  }

  set(key: string, value: T) {
    this.values.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  invalidatePrefix(prefix: string) {
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) this.values.delete(key);
    }
  }

  async load(
    key: string,
    loader: () => Promise<T>,
    options: { force?: boolean; shouldCache?: (value: T) => boolean } = {},
  ) {
    if (!options.force) {
      const cached = this.get(key);
      if (cached !== undefined) return cached;
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = loader()
      .then((value) => {
        if (!options.shouldCache || options.shouldCache(value)) this.set(key, value);
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }
}
