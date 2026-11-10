// Runs one load at a time, with two ways to ask for one.
//
//   const queue = createLoadQueue(run);
//   queue.join()   the timer's way: use the load that is running, or start one.
//   queue.fresh()  after a change: a load that begins after this call.
//
// The difference matters when a load is already running. That load may have read the server before the
// change was saved, so joining it would hand back the data from before the change. fresh() waits for the
// running load and then runs one more. However many callers ask while a load is running, they share that
// one follow-up, so a burst of changes costs one extra load, not one each.

export interface LoadQueue {
  /** The load in flight, or a new one when none is running. */
  join(): Promise<void>;
  /** A load that starts after this call. Resolves when that load has finished. */
  fresh(): Promise<void>;
}

/** `run` does one load and must not reject: it reports its own failures (the provider keeps them in state). */
export function createLoadQueue(run: () => Promise<void>): LoadQueue {
  let inFlight: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;

  const start = (): Promise<void> => {
    const current: Promise<void> = run().finally(() => {
      if (inFlight === current) inFlight = null;
    });
    inFlight = current;
    return current;
  };

  return {
    join: () => inFlight ?? start(),
    fresh() {
      if (!inFlight) return start();
      if (!followUp) {
        const next = () => {
          followUp = null;
          // Whatever is running by now began after fresh() was called, so it will do.
          return inFlight ?? start();
        };
        followUp = inFlight.then(next, next);
      }
      return followUp;
    },
  };
}
