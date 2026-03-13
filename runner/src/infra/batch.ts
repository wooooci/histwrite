export function chunkIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const normalizedSize = Math.max(1, Math.floor(batchSize));
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += normalizedSize) {
    batches.push(items.slice(index, index + normalizedSize));
  }
  return batches;
}

export function selectNBest<T>(params: {
  items: T[];
  limit: number;
  score: (item: T) => number;
  isPass?: (item: T) => boolean;
}): T[] {
  const limit = Math.max(1, Math.floor(params.limit));
  const sorted = [...params.items].sort((left, right) => params.score(right) - params.score(left));
  const passFirst = typeof params.isPass === "function" ? sorted.filter((item) => params.isPass?.(item)) : sorted;
  const out: T[] = passFirst.slice(0, limit);
  if (out.length >= limit) return out;

  for (const item of sorted) {
    if (out.includes(item)) continue;
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
