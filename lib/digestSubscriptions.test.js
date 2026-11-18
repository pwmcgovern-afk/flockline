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

  it("carries the signup source through the token and tolerates its absence", () => {
    const withSource = createDigestConfirmationToken({
      email: "birder@example.com",
      regionIds: ["northeast"],
      src: "ctbirds"
    }, environment.DIGEST_SIGNING_SECRET);
    expect(verifyDigestConfirmationToken(withSource, environment.DIGEST_SIGNING_SECRET))
      .toMatchObject({ src: "ctbirds" });

    // Tokens minted before source tracking existed (or with a junk src) still
    // verify; the source simply comes back null.
    const withoutSource = createDigestConfirmationToken({
      email: "birder@example.com",
      regionIds: ["northeast"],
      src: "not a valid slug!!"
    }, environment.DIGEST_SIGNING_SECRET);
    const verified = verifyDigestConfirmationToken(withoutSource, environment.DIGEST_SIGNING_SECRET);
    expect(verified?.email).toBe("birder@example.com");
    expect(verified?.src).toBeNull();
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

  it("updates only the selected schedule for an active contact", async () => {
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

    expect(update).not.toHaveBeenCalled();
    expect(updateTopics.mock.calls[0][0].topics).toHaveLength(5);
    expect(add).toHaveBeenCalledWith({ email: "birder@example.com", segmentId: "seg_digest" });
    expect(updateTopics).toHaveBeenCalledWith(expect.objectContaining({
      email: "birder@example.com",
      topics: expect.arrayContaining([{ id: "topic_mw", subscription: "opt_in" }])
    }));
  });
  it("clears other schedule opt-ins before lifting a global unsubscribe", async () => {
    const config = getDigestConfiguration(environment);
    const contacts = {
      get: async () => ({ data: { unsubscribed: true } }),
      update: vi.fn(async () => ({ data: { id: "subscriber" } })),
      segments: { list: async () => ({ data: { data: [{ id: config.segmentId }] } }) },
      topics: { update: vi.fn().mockResolvedValueOnce({ error: { message: "Try again" } }).mockResolvedValue({}) },
    };
    try {
      for (const region of config.regions) {
        vi.stubEnv("RESEND_DAILY_TOPIC_" + region.id.toUpperCase(), "daily-" + region.id);
      }
      const confirm = () => confirmDigestContact({ email: "birder@example.com", regionIds: ["west"] }, config, { contacts });
      await expect(confirm()).rejects.toThrow("Try again");
      expect(contacts.update).not.toHaveBeenCalled();
      await confirm();
      const saved = contacts.topics.update.mock.calls[1][0].topics;
      expect(saved.filter((topic) => topic.subscription === "opt_in")).toEqual([{ id: "topic_we", subscription: "opt_in" }]);
      expect(saved.filter((topic) => topic.id.startsWith("daily-"))).toHaveLength(5);
      expect(contacts.update).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

});
