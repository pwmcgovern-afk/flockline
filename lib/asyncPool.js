export async function settleWithConcurrency(items, concurrency, worker) {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }

  const limit = Math.max(1, Math.min(items.length, Math.floor(Number(concurrency)) || 1));
  const results = new Array(items.length);
  let cursor = 0;

  async function runNext() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runNext()));
  return results;
}
