// Bound the entire response, including reading JSON. A stalled connection
// should always return control to the reader, including the signup form.
export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 45000,
): Promise<{ response: Response; body: T }> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  init.signal?.addEventListener("abort", cancel, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timeout = window.setTimeout(cancel, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = (await response.json()) as T;
    return { response, body };
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) {
      throw new Error("The request took too long. Please try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", cancel);
  }
}
