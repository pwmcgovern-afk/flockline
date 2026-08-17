import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("weekly email digest surface", () => {
  it("offers confirmed, multi-region signup from both roundup states", () => {
    const app = read("src/App.tsx");
    const signup = read("src/DigestSignup.tsx");
    const styles = read("src/styles.css");

    expect(app.match(/<DigestSignup/g)).toHaveLength(4);
    expect(app).toContain('variant="header"');
    expect(signup).toContain("Get weekly insights by email");
    expect(signup).toContain("Get weekly insights");
    expect(signup).toContain("10 AM ET every Monday");
    expect(signup).toContain("Choose regional editions");
    expect(signup).toContain("/api/digest-subscription");
    expect(signup).toContain("Check your inbox");
    expect(styles).toContain(".digest-header .digest-cta");
    expect(styles).toContain("background: var(--accent)");
  });

  it("secures weekly delivery and schedules it for Monday morning", () => {
    const cron = read("api/cron/weekly-digests.js");
    const vercel = JSON.parse(read("vercel.json"));

    expect(cron).toContain("Bearer ${cronSecret}");
    expect(cron).toContain("getWeeklyRoundup");
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/weekly-digests",
      schedule: "0 14,15 * * 1"
    });
  });
});
