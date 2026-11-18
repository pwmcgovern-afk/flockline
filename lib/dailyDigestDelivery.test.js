import { describe, expect, it, vi } from "vitest";
import { dailyBroadcast, deliverDailyDigest } from "./dailyDigestDelivery.js";
import { createDigestConfirmationToken, getDigestConfiguration, verifyDigestConfirmationToken } from "./digestSubscriptions.js";

const region = { id: "west", name: "West", topicId: "daily-west" };
const configuration = { ready: true, frequency: "daily", regions: [region], segmentId: "daily-segment", publicAppUrl: "https://flockline.app" };
const digest = { scopeId: "west", date: "2026-11-18", back: 1, findings: [{ title: "Hudsonian Godwit", detail: "Seen at A & B" }] };

describe("daily email", () => {
  it("keeps the chosen frequency in confirmation and requires separate daily routing", () => {
    const token = createDigestConfirmationToken({ email: "birder@example.com", regionIds: ["west"], frequency: "daily" }, "test");
    expect(verifyDigestConfirmationToken(token, "test")).toMatchObject({ frequency: "daily", regionIds: ["west"] });
    const config = getDigestConfiguration({ RESEND_DIGEST_SEGMENT_ID: "weekly", RESEND_TOPIC_WEST: "weekly-west" }, "daily");
    expect(config.ready).toBe(false);
    expect(config.missing).toContain("RESEND_DAILY_SEGMENT_ID");
    expect(config.missing).toContain("RESEND_DAILY_TOPIC_WEST");
  });

  it("uses the saved region and date, source details, and provider preference link", () => {
    const message = dailyBroadcast(digest, region, configuration);
    expect(message).toMatchObject({ segmentId: "daily-segment", topicId: "daily-west" });
    expect(message.text).toContain("Hudsonian Godwit");
    expect(message.html).toContain("A &amp; B");
    for (const body of [message.text, message.html]) {
      expect(body).toContain("/digest/west/2026-11-18");
      expect(body).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    }
  });

  it("resumes the same campaign after an uncertain send and skips an empty audience", async () => {
    let value;
    const store = {
      read: async () => value ? { value, etag: "v" } : null,
      write: async (path, next) => {
        expect(path).toBe("digest-daily-delivery/2026-11-18/west.json");
        value = next;
        return { value, etag: "v" };
      },
    };
    const provider = {
      hasRecipients: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
      findBroadcast: vi.fn(async () => null),
      createDraft: vi.fn(async () => ({ id: "campaign" })),
      getBroadcast: vi.fn().mockResolvedValueOnce({ id: "campaign", status: "draft" }).mockResolvedValue({ id: "campaign", status: "sent" }),
      sendBroadcast: vi.fn().mockRejectedValueOnce(new Error("Response lost")),
    };
    const run = () => deliverDailyDigest(digest, { provider, store, configuration });
    expect(await run()).toMatchObject({ status: "no_recipients" });
    expect(provider.createDraft).not.toHaveBeenCalled();
    await expect(run()).rejects.toThrow("Response lost");
    expect(await run()).toMatchObject({ status: "sent", broadcastId: "campaign" });
    expect(await run()).toMatchObject({ alreadyComplete: true });
    expect(provider.sendBroadcast).toHaveBeenCalledTimes(1);
    expect(provider.createDraft).toHaveBeenCalledTimes(1);
  });
});
