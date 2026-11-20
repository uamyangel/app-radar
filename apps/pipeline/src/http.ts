/**
 * 按主机限速 + 指数退避重试的 HTTP 客户端。
 * 同一主机的请求串行排队，保证间隔；不同主机互不影响。
 */
export const UA = "app-radar/0.1 (personal research; low frequency)";

export type HttpResult = { ok: boolean; status: number; text: string; attempts: number };

export class HttpClient {
  private nextSlot = new Map<string, number>();
  private intervals = new Map<string, number>();
  readonly stats = { requests: 0, ok: 0, failed: 0, retries: 0, byStatus: {} as Record<string, number> };

  constructor(
    private opts: { defaultIntervalMs: number; maxRetries: number; timeoutMs: number },
  ) {}

  setHostInterval(host: string, ms: number) {
    this.intervals.set(host, ms);
  }

  /** 预约该主机的下一个可用时间片，返回需要等待的毫秒数 */
  private reserve(host: string): number {
    const interval = this.intervals.get(host) ?? this.opts.defaultIntervalMs;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + interval);
    return slot - now;
  }

  async get(
    url: string,
    o: { headers?: Record<string, string>; maxRetries?: number; retryOn?: (status: number) => boolean } = {},
  ): Promise<HttpResult> {
    const host = new URL(url).host;
    const maxRetries = o.maxRetries ?? this.opts.maxRetries;
    const retryOn = o.retryOn ?? ((s: number) => s === 429 || s >= 500);
    let last: HttpResult = { ok: false, status: 0, text: "", attempts: 0 };
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        this.stats.retries++;
        await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 500);
      }
      const wait = this.reserve(host);
      if (wait > 0) await sleep(wait);
      this.stats.requests++;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, ...o.headers },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        const text = await res.text();
        this.count(String(res.status));
        last = { ok: res.ok, status: res.status, text, attempts: attempt + 1 };
        if (res.ok || !retryOn(res.status)) break;
      } catch (e) {
        const name = e instanceof Error ? e.name : "Error";
        this.count(name);
        last = { ok: false, status: 0, text: String(e), attempts: attempt + 1 };
      }
    }
    if (last.ok) this.stats.ok++;
    else this.stats.failed++;
    return last;
  }

  private count(k: string) {
    this.stats.byStatus[k] = (this.stats.byStatus[k] ?? 0) + 1;
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
