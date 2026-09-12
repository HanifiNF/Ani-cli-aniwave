import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  signal: AbortSignal;
  priority: number;
  refresh?: boolean;
  scope: string;
}
export const catalogContext = new AsyncLocalStorage<RequestContext>();
const cancelled = () => new DOMException("Catalog request cancelled", "AbortError");
interface Cached { body: string; expires: number; bytes: number; }
interface Consumer { resolve: (body: string) => void; reject: (reason: unknown) => void; cleanup: () => void; }
interface Job {
  key: string; host: string; priority: number; refresh: boolean; started: boolean; controller: AbortController;
  consumers: Set<Consumer>; execute: (signal: AbortSignal) => Promise<string>; ttl: number;
}

/** Share response bodies, rather than Response objects whose bodies can only be consumed once. */
export class CatalogRequests {
  private cache = new Map<string, Cached>();
  private bytes = 0;
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private active = new Set<Job>();
  private cooldowns = new Map<string, { until: number; message: string }>();

  read(key: string, host: string, ttl: number, execute: (signal: AbortSignal) => Promise<string>, context: RequestContext): Promise<string> {
    if (context.signal.aborted) return Promise.reject(cancelled());
    key = `${context.scope}:${key}`;
    host = `${context.scope}:${host}`;
    const cached = this.cache.get(key);
    if (!context.refresh && cached && cached.expires > Date.now()) {
      this.cache.delete(key); this.cache.set(key, cached);
      return Promise.resolve(cached.body);
    }
    const cooldown = this.cooldowns.get(host);
    if (!context.refresh && cooldown && cooldown.until > Date.now()) return Promise.reject(new Error(cooldown.message));
    if (cooldown) this.cooldowns.delete(host);
    let job = this.jobs.get(key);
    if (!job) {
      job = { key, host, priority: context.priority, refresh: context.refresh === true, started: false, controller: new AbortController(), consumers: new Set(), execute, ttl };
      this.jobs.set(key, job); this.queue.push(job);
    }
    job.priority = Math.min(job.priority, context.priority);
    job.refresh ||= context.refresh === true;
    const shared = job;
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        shared.consumers.delete(consumer); consumer.cleanup(); reject(cancelled());
        if (!shared.consumers.size) {
          shared.controller.abort();
          if (this.jobs.get(key) === shared) this.jobs.delete(key);
          this.queue = this.queue.filter((item) => item !== shared);
        }
        this.pump();
      };
      const consumer: Consumer = { resolve, reject, cleanup: () => context.signal.removeEventListener("abort", abort) };
      shared.consumers.add(consumer);
      context.signal.addEventListener("abort", abort, { once: true });
      this.pump();
    });
  }

  private pump() {
    this.queue.sort((a, b) => a.priority - b.priority);
    for (let index = 0; index < this.queue.length;) {
      const job = this.queue[index];
      const cooldown = this.cooldowns.get(job.host);
      if (!job.refresh && cooldown && cooldown.until > Date.now()) {
        this.queue.splice(index, 1); this.jobs.delete(job.key);
        for (const consumer of job.consumers) { consumer.cleanup(); consumer.reject(new Error(cooldown.message)); }
        job.consumers.clear(); continue;
      }
      // Reserve capacity for playback. A single host gets at most two background requests.
      const totalLimit = job.priority === 0 ? 6 : 5;
      const hostLimit = job.priority === 0 ? 3 : 2;
      if (this.active.size >= totalLimit || [...this.active].filter((active) => active.host === job.host).length >= hostLimit) { index += 1; continue; }
      this.queue.splice(index, 1); this.active.add(job); job.started = true;
      void job.execute(job.controller.signal).then((body) => {
        if (job.controller.signal.aborted) return;
        this.cooldowns.delete(job.host);
        this.put(job.key, body, job.ttl);
        for (const consumer of job.consumers) { consumer.cleanup(); consumer.resolve(body); }
      }, (reason: unknown) => {
        if (!job.controller.signal.aborted && reason instanceof CatalogNetworkError) {
          this.cooldowns.set(job.host, { until: Date.now() + 10_000, message: `${reason.message}. Temporarily backing off; Retry checks again.` });
          if (this.cooldowns.size > 100) this.cooldowns.delete(this.cooldowns.keys().next().value!);
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
export class CatalogNetworkError extends Error {}
export const catalogRequests = new CatalogRequests();
