import { describe, expect, it, vi } from "vitest";
import { dailyBroadcast, deliverDailyDigest } from "./dailyDigestDelivery.js";
import { createDigestConfirmationToken, getDigestConfiguration, verifyDigestConfirmationToken } from "./digestSubscriptions.js";

const region = { id: "west", name: "West", topicId: "daily-west" };
const configuration = { ready: true, frequency: "daily", regions: [region], segmentId: "daily-segment", publicAppUrl: "https://flockline.app" };
const digest = { scopeId: "west", date: "2026-11-18", back: 1, findings: [{
  title: "Hudsonian Godwit", detail: "Seen at A & B", comName: "Hudsonian Godwit", speciesCode: "hudgod",
  locName: "A & B Marsh", region: "Oregon", obsDt: "2026-11-18 08:10", howMany: 2, subId: "S1",
  image: { kind: "species-illustration", url: "https://flockline.app/digest-illustrations/hudgod-v1.jpg", alt: "Hudsonian Godwit illustration" },
}] };

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
    expect(message.html).toContain("Daily digest · West");
    expect(message.html).toContain('<img src="https://flockline.app/digest-illustrations/hudgod-v1.jpg"');
    expect(message.html).toContain("https://ebird.org/checklist/S1");
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
    const illustrate = vi.fn(async (edition) => edition);
    const run = () => deliverDailyDigest(digest, { provider, store, configuration, illustrate });
    expect(await run()).toMatchObject({ status: "no_recipients" });
    expect(provider.createDraft).not.toHaveBeenCalled();
    await expect(run()).rejects.toThrow("Response lost");
    expect(await run()).toMatchObject({ status: "sent", broadcastId: "campaign" });
    expect(await run()).toMatchObject({ alreadyComplete: true });
    expect(provider.sendBroadcast).toHaveBeenCalledTimes(1);
    expect(provider.createDraft).toHaveBeenCalledTimes(1);
  });

  it("draws missing art before sending, holds early attempts, and sends text-only cards last", async () => {
    let value;
    const store = {
      read: async () => value ? { value, etag: "v" } : null,
      write: async (_path, next) => { value = next; return { value, etag: "v" }; },
    };
    const provider = {
      hasRecipients: vi.fn(async () => true),
      findBroadcast: vi.fn(async () => null),
      createDraft: vi.fn(async () => ({ id: "campaign" })),
      getBroadcast: vi.fn().mockResolvedValueOnce({ id: "campaign", status: "draft" }).mockResolvedValue({ id: "campaign", status: "sent" }),
      sendBroadcast: vi.fn(async () => ({})),
    };
    const bare = { ...digest, findings: [{ ...digest.findings[0], image: undefined }] };
    const illustrate = vi.fn(async (edition) => edition);
    expect(await deliverDailyDigest(bare, { provider, store, configuration, illustrate }))
      .toMatchObject({ status: "awaiting_illustrations", unresolved: ["hudgod"] });
    expect(illustrate).toHaveBeenLastCalledWith(bare, "https://flockline.app", expect.objectContaining({ generateMissing: true }));
    expect(provider.createDraft).not.toHaveBeenCalled();

    expect(await deliverDailyDigest(bare, { provider, store, configuration, illustrate, generateMissing: false, allowPartialArtwork: true }))
      .toMatchObject({ status: "sent", partialArtwork: true });
    expect(illustrate).toHaveBeenLastCalledWith(bare, "https://flockline.app", expect.objectContaining({ generateMissing: false }));
    expect(provider.createDraft).toHaveBeenCalledTimes(1);
  });

  it("puts freshly drawn plates in the email", async () => {
    let value;
    const store = {
      read: async () => value ? { value, etag: "v" } : null,
      write: async (_path, next) => { value = next; return { value, etag: "v" }; },
    };
    const provider = {
      hasRecipients: vi.fn(async () => true),
      findBroadcast: vi.fn(async () => null),
      createDraft: vi.fn(async () => ({ id: "campaign" })),
      getBroadcast: vi.fn().mockResolvedValueOnce({ id: "campaign", status: "draft" }).mockResolvedValue({ id: "campaign", status: "sent" }),
      sendBroadcast: vi.fn(async () => ({})),
    };
    const plate = "https://store.public.blob.vercel-storage.com/illustrations/hudgod-v1.jpg";
    const illustrate = async (edition) => ({ ...edition, findings: edition.findings.map((bird) => ({ ...bird, image: { kind: "species-illustration", url: plate, alt: "Hudsonian Godwit" } })) });
    expect(await deliverDailyDigest({ ...digest, findings: [{ ...digest.findings[0], image: undefined }] }, { provider, store, configuration, illustrate }))
      .toMatchObject({ status: "sent", illustrations: 1, unresolved: [] });
    expect(provider.createDraft.mock.calls[0][0].html).toContain(`<img src="${plate}"`);
  });
});
