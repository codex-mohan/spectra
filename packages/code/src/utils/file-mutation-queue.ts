const mutationQueues = new Map<string, Promise<unknown>>();

export function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const existing = mutationQueues.get(filePath) ?? Promise.resolve();
  const next = existing.then(() => fn(), (err) => {
    throw err;
  });
  mutationQueues.set(filePath, next);
  void next.finally(() => {
    if (mutationQueues.get(filePath) === next) {
      mutationQueues.delete(filePath);
    }
  });
  return next;
}