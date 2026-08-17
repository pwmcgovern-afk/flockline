import { describe, expect, it, vi } from "vitest";
import {
  confirmDigestContact,
  createDigestConfirmationToken,
  getDigestConfiguration,
  normalizeDigestEmail,
  verifyDigestConfirmationToken
} from "./digestSubscriptions.js";

const environment = {
  RESEND_API_KEY: "re_test",
  RESEND_DIGEST_SEGMENT_ID: "seg_digest",
  RESEND_TOPIC_NATIONWIDE: "topic_us",
  RESEND_TOPIC_NORTHEAST: "topic_ne",
  RESEND_TOPIC_MIDWEST: "topic_mw",
  RESEND_TOPIC_SOUTH: "topic_so",
  RESEND_TOPIC_WEST: "topic_we",
  DIGEST_SIGNING_SECRET: "a-long-test-signing-secret",
  RESEND_FROM: "Flockline <digest@flockline.app>"
};

describe("digest confirmation tokens", () => {
  it("normalizes the request and verifies it for 24 hours", () => {
    const token = createDigestConfirmationToken({
      email: " Birder@Example.COM ",
      regionIds: ["northeast", "west", "northeast", "made-up"]
    }, environment.DIGEST_SIGNING_SECRET, 1_000);

    expect(verifyDigestConfirmationToken(token, environment.DIGEST_SIGNING_SECRET, 2_000)).toMatchObject({
      email: "birder@example.com",
      regionIds: ["northeast", "west"]
    });
    expect(verifyDigestConfirmationToken(token, environment.DIGEST_SIGNING_SECRET, 86_401_001)).toBeNull();
    expect(token).not.toContain(Buffer.from("birder@example.com").toString("base64url"));
  });

  it("rejects a changed signature or invalid email", () => {
    const token = createDigestConfirmationToken({
      email: "birder@example.com",
      regionIds: ["south"]
    }, environment.DIGEST_SIGNING_SECRET);

    expect(verifyDigestConfirmationToken(`${token}changed`, environment.DIGEST_SIGNING_SECRET)).toBeNull();
    expect(normalizeDigestEmail("not-an-email")).toBeNull();
  });
});

describe("digest configuration", () => {
  it("reports the exact missing regional resources", () => {
    const configuration = getDigestConfiguration({
      ...environment,
      RESEND_TOPIC_WEST: ""
    });

    expect(configuration.ready).toBe(false);
    expect(configuration.missing).toEqual(["RESEND_TOPIC_WEST"]);
  });
});

describe("confirmDigestContact", () => {
  it("creates a new contact with explicit preferences for every topic", async () => {
    const configuration = getDigestConfiguration(environment);
    const create = vi.fn(async () => ({ data: { id: "contact_1" }, error: null }));
    const resend = {
      contacts: {
        get: vi.fn(async () => ({ data: null, error: { statusCode: 404, message: "Not found" } })),
        create
      }
    };

    await confirmDigestContact({
      email: "birder@example.com",
      regionIds: ["northeast", "west"]
    }, configuration, resend);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      email: "birder@example.com",
      segments: [{ id: "seg_digest" }],
      topics: [
        { id: "topic_us", subscription: "opt_out" },
        { id: "topic_ne", subscription: "opt_in" },
        { id: "topic_mw", subscription: "opt_out" },
        { id: "topic_so", subscription: "opt_out" },
        { id: "topic_we", subscription: "opt_in" }
      ]
    }));
  });

  it("reactivates an existing contact and updates regional preferences", async () => {
    const configuration = getDigestConfiguration(environment);
    const update = vi.fn(async () => ({ data: { id: "contact_1" }, error: null }));
    const add = vi.fn(async () => ({ data: { id: "contact_1" }, error: null }));
    const updateTopics = vi.fn(async () => ({ data: { id: "contact_1" }, error: null }));
    const resend = {
      contacts: {
        get: vi.fn(async () => ({ data: { id: "contact_1" }, error: null })),
        update,
        segments: {
          list: vi.fn(async () => ({ data: { data: [] }, error: null })),
          add
        },
        topics: { update: updateTopics }
      }
    };

    await confirmDigestContact({
      email: "birder@example.com",
      regionIds: ["midwest"]
    }, configuration, resend);

    expect(update).toHaveBeenCalledWith({ email: "birder@example.com", unsubscribed: false });
    expect(add).toHaveBeenCalledWith({ email: "birder@example.com", segmentId: "seg_digest" });
    expect(updateTopics).toHaveBeenCalledWith(expect.objectContaining({
      email: "birder@example.com",
      topics: expect.arrayContaining([{ id: "topic_mw", subscription: "opt_in" }])
    }));
  });
});
