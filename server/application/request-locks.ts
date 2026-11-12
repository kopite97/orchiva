// All commands and lifecycle hooks share this queue so a late event cannot
// overwrite a concurrent start, validation, review, or recovery checkpoint.
export class RequestLocks {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.tails.set(key, next);
    try { return await next; } finally { if (this.tails.get(key) === next) this.tails.delete(key); }
  }
}
