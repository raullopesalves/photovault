/** Runs fn over items with bounded concurrency, preserving result order. */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      signal?.throwIfAborted()
      const i = next++
      results[i] = await fn(items[i] as T, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export function isoOrNull(d: Date | null | undefined): string | null {
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : null
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
