import { describe, expect, it, vi } from "vitest";
import { alertPath, runDigestAlert, summarizeDigestWeek } from "./digestAlert.js";
import { deliveryPath } from "./digestDeliveryStore.js";

const date = "2026-11-16";
const regions = ["nationwide", "northeast", "midwest", "south", "west"];

function memoryStore(records) {
  const map = new Map(Object.entries(records).map(([region, value]) => [deliveryPath(date, region), { value }]));
  return {
    map,
    read: vi.fn(async (path) => map.get(path) || null),
    write: vi.fn(async (path, value) => { map.set(path, { value }); return { value }; })
  };
}
const allSent = Object.fromEntries(regions.map((region) => [region, { status: region === "west" ? "no_recipients" : "sent" }]));
const environment = { DIGEST_ALERT_EMAIL: "owner@example.test", RESEND_FROM: "Flockline <digest@updates.flockline.app>" };

describe("Monday digest alert", () => {
  it("stays silent when every region was sent or had no subscribers", async () => {
    const send = vi.fn();
    const result = await runDigestAlert({ date, environment }, { store: memoryStore(allSent), send });
    expect(result).toMatchObject({ healthy: true, alerted: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("emails once when a region was held, failed, or never ran", async () => {
    const store = memoryStore({ ...allSent,
      northeast: { status: "awaiting_illustrations", findings: 6, unresolved: ["a", "b", "c", "d"] },
      south: { status: "failed", failure: { phase: "send_broadcast", code: "http_500" } },
      midwest: undefined
    });
    const send = vi.fn();
    const result = await runDigestAlert({ date, environment }, { store, send });
    expect(result.alerted).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.to).toBe("owner@example.test");
    expect(message.subject).toContain("did not go out for 3 regions");
    expect(message.subject).toContain("Monday, November 16, 2026");
    expect(message.text).toContain("Northeast: not sent, held because 4 of 6 bird drawings could not be made.");
    expect(message.text).toContain("South: not sent, the send job hit an error during the \"send broadcast\" step.");
    expect(message.text).toContain("Midwest: not sent, no record that the send job ran.");
    expect(message.text).toContain("forward this email to Claude or Codex");
    expect(message.text).toContain("northeast: receipt status awaiting_illustrations");
    expect(message.text).not.toContain("node scripts");
    expect(JSON.stringify(store.map.get(alertPath(date)).value)).not.toContain("owner@example.test");

    await runDigestAlert({ date, environment }, { store, send });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("flags a sent edition that went out with missing artwork", () => {
    const summary = summarizeDigestWeek(date, { ...allSent, northeast: { status: "sent", partialArtwork: true, unresolved: ["a"] } });
    expect(summary.healthy).toBe(false);
    expect(summary.problems).toEqual([expect.objectContaining({ region: "northeast", severity: "partial" })]);
  });

  it("refuses to run without a recipient instead of failing silently", async () => {
    await expect(runDigestAlert({ date, environment: {} }, { store: memoryStore(allSent), send: vi.fn() })).rejects.toThrow("DIGEST_ALERT_EMAIL");
  });
});
