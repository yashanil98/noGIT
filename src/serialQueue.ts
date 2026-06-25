// A minimal serializer: runs async tasks one at a time in submission order,
// even when callers do not await between submissions. Each task starts only
// after the previous one settles, so steps that read-then-write shared state
// (such as picking a non-colliding snapshot folder name) cannot interleave.
//
// A rejected task does not poison the chain: the next task still runs. The
// promise returned to the caller still rejects with that task's error.
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
