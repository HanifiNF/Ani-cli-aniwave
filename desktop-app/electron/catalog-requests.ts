import { AsyncLocalStorage } from "node:async_hooks";
import { SourceHealth, type HealthPermit } from "./source-health";

export interface RequestContext {
  signal: AbortSignal;
  priority: number;
  refresh?: boolean;
  /** A manual action can check each host once, shared across its downstream lookups. */
  recoveryChecks?: Set<string>;
  scope: string;
}
export const catalogContext = new AsyncLocalStorage<RequestContext>();
const cancelled = () => new DOMException("Catalog request cancelled", "AbortError");
interface Cached { body: string; expires: number; bytes: number; }
interface Consumer { resolve: (body: string) => void; reject: (reason: unknown) => void; cleanup: () => void; recoveryChecks?: Set<string>; }
interface Job {
  key: string; host: string; priority: number; started: boolean; controller: AbortController; permit?: HealthPermit;
  consumers: Set<Consumer>; execute: (signal: AbortSignal, recovery: boolean) => Promise<string>; ttl: number;
}

/** Share response bodies, rather than Response objects whose bodies can only be consumed once. */
export class CatalogRequests {
  private cache = new Map<string, Cached>();
  private bytes = 0;
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private active = new Set<Job>();
  readonly health = new SourceHealth();

  read(key: string, host: string, ttl: number, execute: (signal: AbortSignal, recovery: boolean) => Promise<string>, context: RequestContext): Promise<string> {
    if (context.signal.aborted) return Promise.reject(cancelled());
    key = `${context.scope}:${key}`;
    const cached = this.cache.get(key);
    if (!context.refresh && cached && cached.expires > Date.now()) {
      this.cache.delete(key); this.cache.set(key, cached);
      return Promise.resolve(cached.body);
    }
    let job = this.jobs.get(key);
    if (!job) {
      job = { key, host, priority: context.priority, started: false, controller: new AbortController(), consumers: new Set(), execute, ttl };
      this.jobs.set(key, job); this.queue.push(job);
    }
    job.priority = Math.min(job.priority, context.priority);
    const shared = job;
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        shared.consumers.delete(consumer); consumer.cleanup(); reject(cancelled());
        if (!shared.consumers.size) {
          shared.controller.abort();
          if (shared.permit) this.health.cancel(shared.permit);
          if (this.jobs.get(key) === shared) this.jobs.delete(key);
          this.queue = this.queue.filter((item) => item !== shared);
        }
        this.pump();
      };
      const consumer: Consumer = { resolve, reject, cleanup: () => context.signal.removeEventListener("abort", abort), recoveryChecks: context.recoveryChecks };
      if (shared.started) context.recoveryChecks?.add(host);
      shared.consumers.add(consumer);
      context.signal.addEventListener("abort", abort, { once: true });
      this.pump();
    });
  }

  private pump() {
    this.queue.sort((a, b) => a.priority - b.priority);
    for (let index = 0; index < this.queue.length;) {
      const job = this.queue[index];
      const checkNow = [...job.consumers].some((consumer) => consumer.recoveryChecks && !consumer.recoveryChecks.has(job.host));
      const blocked = this.health.blocked(job.host, checkNow);
      if (blocked) {
        this.queue.splice(index, 1); this.jobs.delete(job.key);
        for (const consumer of job.consumers) { consumer.cleanup(); consumer.reject(blocked); }
        job.consumers.clear(); continue;
      }
      // Reserve capacity for playback. A single host gets at most two background requests.
      const totalLimit = job.priority === 0 ? 6 : 5;
      const hostLimit = job.priority === 0 ? 3 : 2;
      if (this.active.size >= totalLimit || [...this.active].filter((active) => active.host === job.host).length >= hostLimit) { index += 1; continue; }
      try {
        job.permit = this.health.acquire(job.host, checkNow);
      } catch (error) {
        this.queue.splice(index, 1); this.jobs.delete(job.key);
        for (const consumer of job.consumers) { consumer.cleanup(); consumer.reject(error); }
        job.consumers.clear(); continue;
      }
      for (const consumer of job.consumers) consumer.recoveryChecks?.add(job.host);
      this.queue.splice(index, 1); this.active.add(job); job.started = true;
      const permit = job.permit;
      void job.execute(job.controller.signal, permit.probe).then((body) => {
        if (job.controller.signal.aborted) return;
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        this.health.success(permit);
        this.put(job.key, body, job.ttl);
        for (const consumer of job.consumers) { consumer.cleanup(); consumer.resolve(body); }
      }, (reason: unknown) => {
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        if (!job.controller.signal.aborted && reason instanceof CatalogNetworkError) {
          this.health.failure(permit, reason.retryAfterMs);
        } else if (!job.controller.signal.aborted) {
          // A normal HTTP/content error proves the host responded (for example a missing episode).
          this.health.success(permit);
        }
        for (const consumer of job.consumers) { consumer.cleanup(); consumer.reject(reason); }
      }).finally(() => {
        job.consumers.clear(); this.active.delete(job);
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        this.pump();
      });
    }
  }

  private put(key: string, body: string, ttl: number) {
    const bytes = Buffer.byteLength(body);
    if (bytes > 2_000_000) return;
    const old = this.cache.get(key);
    if (old) this.bytes -= old.bytes;
    this.cache.delete(key); this.cache.set(key, { body, bytes, expires: Date.now() + ttl }); this.bytes += bytes;
    while (this.cache.size > 1000 || this.bytes > 32_000_000) {
      const first = this.cache.keys().next().value!;
      this.bytes -= this.cache.get(first)!.bytes; this.cache.delete(first);
    }
  }
}
export class CatalogNetworkError extends Error {
  constructor(message: string, readonly retryAfterMs = 0) { super(message); this.name = "CatalogNetworkError"; }
}
export const catalogRequests = new CatalogRequests();
