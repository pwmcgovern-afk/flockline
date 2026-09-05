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

  it("gives every edition independent preflight and four Monday delivery attempts", () => {
    const vercel = JSON.parse(read("vercel.json"));
    for (const region of ["nationwide", "northeast", "midwest", "south", "west"]) {
      const sends = vercel.crons.filter((job: { path: string }) => job.path === `/api/cron/weekly-digests?region=${region}`);
      expect(sends).toHaveLength(1);
      const [minutes, hours, day, month, weekday] = sends[0].schedule.split(" ");
      const attempts = minutes.split(",").map(Number);
      expect(attempts).toHaveLength(4);
      expect(attempts.every((minute: number, index: number) => minute >= 0 && minute < 60 && (!index || minute - attempts[index - 1] >= 15))).toBe(true);
      expect([hours, day, month, weekday]).toEqual(["14,15", "*", "*", "1"]);
      expect(vercel.crons.some((job: { path: string }) => job.path === `/api/cron/weekly-digests?region=${region}&mode=check`)).toBe(true);
    }
  });
});
