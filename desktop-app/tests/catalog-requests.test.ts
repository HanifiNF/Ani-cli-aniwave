import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogRequests, CatalogNetworkError, type RequestContext } from "../electron/catalog-requests";
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const context = (signal = new AbortController().signal, priority = 2, refresh = false): RequestContext => ({ signal, priority, refresh, scope: "config-a" });
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe("shared catalog requests", () => {
  it("shares work while cancelling only the departing consumer", async () => {
    const pool = new CatalogRequests(), response = deferred<string>(), background = new AbortController();
    let upstream!: AbortSignal;
    const fetch = vi.fn((signal: AbortSignal) => { upstream = signal; return response.promise; });
    const first = pool.read("episode-sub", "provider", 1000, fetch, context(background.signal));
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const playback = pool.read("episode-sub", "provider", 1000, fetch, context(undefined, 0));
    background.abort(); await rejected;
    expect(upstream.aborted).toBe(false);
    response.resolve("720p"); expect(await playback).toBe("720p"); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts upstream when the last consumer leaves and never caches its late response", async () => {
    const pool = new CatalogRequests(), response = deferred<string>(), controller = new AbortController();
    let upstream!: AbortSignal;
    const first = pool.read("key", "host", 1000, (signal) => { upstream = signal; return response.promise; }, context(controller.signal));
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected; expect(upstream.aborted).toBe(true);
    response.resolve("stale"); await tick();
    expect(await pool.read("key", "host", 1000, async () => "fresh", context())).toBe("fresh");
  });

  it("reserves playback capacity and promotes a shared queued request", async () => {
    const pool = new CatalogRequests(), a = deferred<string>(), b = deferred<string>();
    const first = pool.read("a", "host", 1000, () => a.promise, context());
    const second = pool.read("b", "host", 1000, () => b.promise, context());
    const queued = vi.fn(async () => "next"), urgent = vi.fn(async () => "play");
    const next = pool.read("next", "host", 1000, queued, context());
    const target = pool.read("target", "host", 1000, urgent, context());
    expect(queued).not.toHaveBeenCalled(); expect(urgent).not.toHaveBeenCalled();
    const play = pool.read("target", "host", 1000, urgent, context(undefined, 0));
    expect(await play).toBe("play"); expect(await target).toBe("play"); expect(urgent).toHaveBeenCalledTimes(1);
    a.resolve("a"); b.resolve("b"); await Promise.all([first, second, next]);
  });

  it("expires cache entries, isolates configuration, and bypasses cache on refresh", async () => {
    vi.useFakeTimers(); const pool = new CatalogRequests(); let calls = 0; const fetch = async () => String(++calls);
    expect(await pool.read("key", "host", 1000, fetch, context())).toBe("1"); await tick();
    expect(await pool.read("key", "host", 1000, fetch, context())).toBe("1");
    expect(await pool.read("key", "host", 1000, fetch, { ...context(), scope: "config-b" })).toBe("2"); await tick();
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pool.read("key", "host", 1000, fetch, context())).toBe("3"); await tick();
    expect(await pool.read("key", "host", 1000, fetch, context(undefined, 2, true))).toBe("4");
  });

  it("backs off failing hosts, permits explicit retry, and leaves other hosts usable", async () => {
    const pool = new CatalogRequests(); const fail = vi.fn(async () => { throw new CatalogNetworkError("503"); });
    await expect(pool.read("a", "bad", 1000, fail, context())).rejects.toThrow("503"); await tick();
    await expect(pool.read("b", "bad", 1000, fail, context())).rejects.toThrow("temporarily paused");
    expect(fail).toHaveBeenCalledTimes(1);
    expect(await pool.read("a", "good", 1000, async () => "ok", context())).toBe("ok");
    await expect(pool.read("refresh", "bad", 1000, fail, context(undefined, 2, true))).rejects.toThrow("temporarily paused");
    expect(fail).toHaveBeenCalledTimes(1);
    expect(await pool.read("retry", "bad", 1000, async () => "recovered", { ...context(undefined, 2, true), recoveryChecks: new Set() })).toBe("recovered");
  });

  it("increases cooldowns, admits only one recovery request, and resets after recovery", async () => {
    vi.useFakeTimers(); const pool = new CatalogRequests();
    const fail = vi.fn(async () => { throw new CatalogNetworkError("offline"); });
    await expect(pool.read("first", "host", 1000, fail, context())).rejects.toThrow("offline");
    for (const delay of [30_000, 120_000, 300_000, 900_000, 900_000]) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      await expect(pool.read("paused", "host", 1000, fail, context())).rejects.toThrow("paused");
      await vi.advanceTimersByTimeAsync(1);
      const response = deferred<string>();
      const probe = pool.read("probe", "host", 1000, (_signal, recovery) => { expect(recovery).toBe(true); return response.promise; }, context());
      const rejected = expect(probe).rejects.toThrow("offline");
      await expect(pool.read("another", "host", 1000, fail, { ...context(), recoveryChecks: new Set() })).rejects.toThrow("Checking source recovery");
      response.reject(new CatalogNetworkError("offline")); await rejected; await tick();
    }
    await vi.advanceTimersByTimeAsync(900_000);
    expect(await pool.read("recovered", "host", 1000, async () => "ok", context())).toBe("ok");
    await expect(pool.read("new-failure", "host", 1000, fail, context())).rejects.toThrow("offline");
    expect(pool.health.blocked("host", false)?.retryAt).toBe(Date.now() + 30_000);
  });

  it("shares a recovery request and ignores a late success from before the outage", async () => {
    const pool = new CatalogRequests(), old = deferred<string>();
    const first = pool.read("old", "host", 1000, () => old.promise, context());
    await expect(pool.read("failure", "host", 1000, async () => { throw new CatalogNetworkError("offline"); }, context())).rejects.toThrow("offline");
    old.resolve("old"); await first;
    await expect(pool.read("blocked", "host", 1000, async () => "oops", context())).rejects.toThrow("paused");
    const recovered = deferred<string>(), fetch = vi.fn(() => recovered.promise);
    const probe = pool.read("same", "host", 1000, fetch, { ...context(), recoveryChecks: new Set() });
    const shared = pool.read("same", "host", 1000, fetch, context());
    recovered.resolve("ok"); expect(await Promise.all([probe, shared])).toEqual(["ok", "ok"]); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("limits one manual action to one attempt per host, across different downstream URLs", async () => {
    const pool = new CatalogRequests(), manual = { ...context(), refresh: true, recoveryChecks: new Set<string>() };
    const fail = vi.fn(async () => { throw new CatalogNetworkError("offline"); });
    await expect(pool.read("first", "host", 1000, fail, manual)).rejects.toThrow("offline");
    await expect(pool.read("next", "host", 1000, fail, manual)).rejects.toThrow("paused");
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it("keeps fresh cache usable and outage protection shared across source settings", async () => {
    const pool = new CatalogRequests();
    expect(await pool.read("cached", "host", 60_000, async () => "cached", context())).toBe("cached");
    await expect(pool.read("bad", "host", 1000, async () => { throw new CatalogNetworkError("offline"); }, context())).rejects.toThrow("offline");
    expect(await pool.read("cached", "host", 60_000, async () => "new", context())).toBe("cached");
    await expect(pool.read("other-config", "host", 1000, async () => "new", { ...context(), scope: "changed" })).rejects.toThrow("paused");
    expect(await pool.read("new-address", "new-host", 1000, async () => "ok", context())).toBe("ok");
  });

  it("releases a cancelled recovery probe and excludes cancellations and missing episodes from failures", async () => {
    const pool = new CatalogRequests();
    await expect(pool.read("404", "host", 1000, async () => { throw new Error("Episode missing (404)"); }, context())).rejects.toThrow("404");
    expect(pool.health.blocked("host", false)).toBeUndefined();
    await expect(pool.read("bad", "host", 1000, async () => { throw new CatalogNetworkError("offline"); }, context())).rejects.toThrow("offline");
    const controller = new AbortController(), pending = deferred<string>();
    const probe = pool.read("probe", "host", 1000, () => pending.promise, { ...context(controller.signal), recoveryChecks: new Set() });
    const cancelled = expect(probe).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await cancelled;
    expect(await pool.read("second-probe", "host", 1000, async () => "recovered", { ...context(), recoveryChecks: new Set() })).toBe("recovered");
    pending.reject(new CatalogNetworkError("late failure")); await tick();
    expect(pool.health.blocked("host", false)).toBeUndefined();
  });
});
