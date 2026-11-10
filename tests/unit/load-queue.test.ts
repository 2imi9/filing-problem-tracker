import { describe, expect, it } from "vitest";
import { createLoadQueue } from "@/components/data/loadQueue";

/** A stand-in for the provider's load: each run reads the "server" when it starts and finishes when released. */
function harness() {
  const server = { flags: 900 };
  const seen: number[] = [];
  const releases: (() => void)[] = [];
  let shown = 0;
  const run = () => {
    const read = server.flags;
    seen.push(read);
    return new Promise<void>((resolve) => {
      releases.push(() => {
        shown = read;
        resolve();
      });
    });
  };
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return { server, seen, releases, shown: () => shown, queue: createLoadQueue(run), tick };
}

describe("createLoadQueue", () => {
  it("join() shares the load that is running and starts one when none is", async () => {
    const { queue, seen, releases, tick } = harness();
    const first = queue.join();
    expect(queue.join()).toBe(first);
    expect(seen).toHaveLength(1);
    releases[0]();
    await first;
    await tick();
    const second = queue.join();
    expect(second).not.toBe(first);
    expect(seen).toHaveLength(2);
    releases[1]();
    await second;
  });

  it("fresh() after a save never resolves with a read taken before the save", async () => {
    const { queue, server, seen, releases, shown, tick } = harness();
    // The 30 second timer starts a load, which reads 900 flags.
    void queue.join();
    // The clerk saves a filing while that load is still on its way back.
    server.flags = 901;
    let done = false;
    const refreshed = queue.fresh().then(() => {
      done = true;
    });
    await tick();
    expect(seen).toEqual([900]);

    // The background load lands with the old count. The refresh is not finished: one more load runs.
    releases[0]();
    await tick();
    expect(done).toBe(false);
    expect(seen).toEqual([900, 901]);
    releases[1]();
    await refreshed;
    expect(shown()).toBe(901);
  });

  it("fresh() starts at once when nothing is running", async () => {
    const { queue, seen, releases } = harness();
    const refreshed = queue.fresh();
    expect(seen).toHaveLength(1);
    releases[0]();
    await refreshed;
  });

  it("several refreshes during one load share a single follow-up", async () => {
    const { queue, seen, releases, tick } = harness();
    void queue.join();
    const a = queue.fresh();
    const b = queue.fresh();
    const c = queue.fresh();
    expect(b).toBe(a);
    expect(c).toBe(a);
    releases[0]();
    await tick();
    expect(seen).toHaveLength(2);
    // The timer fires during the follow-up: it joins it, and a later refresh queues one more.
    void queue.join();
    expect(seen).toHaveLength(2);
    const later = queue.fresh();
    expect(later).not.toBe(a);
    releases[1]();
    await a;
    await tick();
    expect(seen).toHaveLength(3);
    releases[2]();
    await later;
  });

  it("runs the follow-up even when the load in flight fails", async () => {
    let calls = 0;
    const queue = createLoadQueue(async () => {
      calls += 1;
      if (calls === 1) {
        await Promise.resolve();
        throw new Error("the first load failed");
      }
    });
    const first = queue.join();
    const refreshed = queue.fresh();
    await expect(first).rejects.toThrow("the first load failed");
    await refreshed;
    expect(calls).toBe(2);
  });
});
