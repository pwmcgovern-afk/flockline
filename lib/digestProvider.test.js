import { describe, expect, it, vi } from "vitest";
import { createDigestProvider } from "./digestProvider.js";

const configuration = { segmentId: "segment" };
const region = { topicId: "topic" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

describe("digest provider", () => {
  it("honors global unsubscribe and explicit topic opt-out across contact pages", async () => {
    const fetcher = vi.fn(async (url) => {
      if (url.endsWith("/topics/topic")) return json({ default_subscription: "opt_in" });
      if (url.includes("/segments/segment/contacts?limit=100&after=a")) return json({ data: [{ id: "b", unsubscribed: false }], has_more: false });
      if (url.includes("/segments/segment/contacts")) return json({ data: [{ id: "ignored", unsubscribed: true }, { id: "a", unsubscribed: false }], has_more: true });
      if (url.includes("/contacts/a/topics")) return json({ data: [{ id: "topic", subscription: "opt_out" }] });
      if (url.includes("/contacts/b/topics")) return json({ data: [{ id: "topic", subscription: "opt_in" }] });
      throw new Error(`Unexpected URL: ${url}`);
    });
    expect(await createDigestProvider("test", { fetcher }).hasRecipients(configuration, region)).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => url.includes("/contacts/ignored/"))).toBe(false);
  });

  it("does not mistake a broken recipient query for an empty audience", async () => {
    const fetcher = vi.fn(async () => json({ message: "Invalid API key" }, 401));
    await expect(createDigestProvider("test", { fetcher }).hasRecipients(configuration, region)).rejects.toThrow("Invalid API key");
  });

  it("always creates a draft even when passed the legacy send=true payload", async () => {
    const fetcher = vi.fn(async () => json({ id: "draft" }));
    await createDigestProvider("test", { fetcher }).createDraft({ name: "edition", send: true });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).send).toBe(false);
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("backs off on rate limits without blindly retrying ambiguous send failures", async () => {
    const sleep = vi.fn(async () => {});
    const fetcher = vi.fn().mockResolvedValueOnce(json({ message: "Rate limited" }, 429)).mockResolvedValueOnce(json({ id: "broadcast" }));
    await createDigestProvider("test", { fetcher, sleep }).sendBroadcast("broadcast");
    expect(sleep).toHaveBeenCalledTimes(1);
    const failed = vi.fn(async () => { throw new Error("Network response lost"); });
    await expect(createDigestProvider("test", { fetcher: failed }).sendBroadcast("broadcast")).rejects.toThrow("Network response lost");
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
