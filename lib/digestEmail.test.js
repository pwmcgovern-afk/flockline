import { describe, expect, it, vi } from "vitest";
import {
  buildWeeklyDigestBroadcast,
  renderDigestHtml,
  sendWeeklyDigestBroadcast
} from "./digestEmail.js";
import { getDigestConfiguration } from "./digestSubscriptions.js";

const configuration = getDigestConfiguration({
  RESEND_API_KEY: "re_test",
  RESEND_DIGEST_SEGMENT_ID: "seg_digest",
  RESEND_TOPIC_NATIONWIDE: "topic_us",
  RESEND_TOPIC_NORTHEAST: "topic_ne",
  RESEND_TOPIC_MIDWEST: "topic_mw",
  RESEND_TOPIC_SOUTH: "topic_so",
  RESEND_TOPIC_WEST: "topic_we",
  DIGEST_SIGNING_SECRET: "a-long-test-signing-secret",
  RESEND_FROM: "Flockline <digest@flockline.app>",
  PUBLIC_APP_URL: "https://flockline.app"
});

const roundup = {
  scopeId: "northeast",
  scopeLabel: "Northeast",
  generatedAt: "2026-08-17T12:00:00.000Z",
  summary: "Six notable birds stood out this week.",
  coverage: { failedRegions: [] },
  findings: [{
    kind: "rarity",
    title: "Rare sighting: Test <Bird>",
    detail: "Test Bird reported at the marsh.",
    speciesCode: "tesbir1",
    comName: "Test Bird",
    sciName: "Avis testus",
    locName: "Verified marsh",
    obsDt: "2026-08-16 08:30",
    howMany: 2,
    subId: "S12345"
  }]
};

describe("weekly digest email", () => {
  it("targets the matching topic and includes preference-safe email content", () => {
    const broadcast = buildWeeklyDigestBroadcast(roundup, configuration);

    expect(broadcast).toMatchObject({
      segmentId: "seg_digest",
      topicId: "topic_ne",
      send: true
    });
    expect(broadcast.html).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(broadcast.html).toContain("bird=tesbir1");
    expect(broadcast.html).toContain("region=northeast");
    expect(broadcast.text).toContain("https://ebird.org/checklist/S12345");
  });

  it("escapes all roundup wording before rendering HTML", () => {
    const html = renderDigestHtml(roundup);
    expect(html).toContain("Test &lt;Bird&gt;");
    expect(html).not.toContain("Test <Bird>");
  });

  it("renders a credited, editorial bird image in HTML and text", () => {
    const illustrated = {
      ...roundup,
      findings: [{
        ...roundup.findings[0],
        image: {
          url: "https://upload.wikimedia.org/test-bird.jpg",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Test_Bird.jpg",
          creator: "Test <Photographer>",
          license: "CC BY 2.0",
          licenseUrl: "https://creativecommons.org/licenses/by/2.0",
          alt: "Test Bird photograph",
          sourceName: "Wikimedia Commons"
        }
      }]
    };

    const broadcast = buildWeeklyDigestBroadcast(illustrated, configuration);
    expect(broadcast.html).toContain("object-fit:cover");
    expect(broadcast.html).toContain("Test &lt;Photographer&gt;");
    expect(broadcast.html).toContain("Wikimedia Commons");
    expect(broadcast.text).toContain("Photo: Test <Photographer> · CC BY 2.0");
  });

  it("uses a deterministic weekly idempotency key", async () => {
    const create = vi.fn(async () => ({ data: { id: "broadcast_1" }, error: null }));
    await sendWeeklyDigestBroadcast(roundup, configuration, {
      broadcasts: { create }
    }, {
      imageResolver: async (value) => value
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: "topic_ne" }),
      { headers: { "Idempotency-Key": "flockline-weekly-northeast-2026-08-17" } }
    );
  });
});
