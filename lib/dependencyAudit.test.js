import { describe, expect, it } from "vitest";
import { DEVELOPMENT_ADVISORY, evaluateAudit } from "../scripts/audit-dependencies.mjs";

function fixture() {
  return {
    audit: { vulnerabilities: {
      picomatch: { severity: "high", nodes: ["node_modules/picomatch"], via: [{ name: "picomatch", url: DEVELOPMENT_ADVISORY }] },
      vite: { severity: "high", nodes: ["node_modules/vite"], via: ["picomatch"] },
    } },
    lock: { packages: {
      "node_modules/picomatch": { dev: true },
      "node_modules/vite": { dev: true },
    } },
  };
}
describe("narrow development dependency exception", () => {
  it("allows only the identified advisory and its development dependency chain", () => {
    const { audit, lock } = fixture();
    expect(evaluateAudit(audit, lock)).toEqual({ blocked: [], excepted: ["picomatch", "vite"] });
  });
  it("fails the same advisory when installed in a production scope", () => {
    const { audit, lock } = fixture();
    lock.packages["node_modules/picomatch"].dev = false;
    expect(evaluateAudit(audit, lock).blocked).toEqual(["picomatch", "vite"]);
  });
  it("fails an unrelated advisory even when only a development dependency is affected", () => {
    const { audit, lock } = fixture();
    audit.vulnerabilities.picomatch.via.push({ name: "picomatch", url: "https://github.com/advisories/GHSA-unrelated" });
    expect(evaluateAudit(audit, lock).blocked).toEqual(["picomatch", "vite"]);
  });
  it("fails missing scope, missing causes, and cyclic dependency evidence", () => {
    const { audit, lock } = fixture();
    delete lock.packages["node_modules/picomatch"];
    expect(evaluateAudit(audit, lock).blocked).toEqual(["picomatch", "vite"]);
    const other = fixture();
    other.audit.vulnerabilities.picomatch.via = ["vite"];
    expect(evaluateAudit(other.audit, other.lock).blocked).toEqual(["picomatch", "vite"]);
    other.audit.vulnerabilities.picomatch.via = [];
    expect(evaluateAudit(other.audit, other.lock).blocked).toEqual(["picomatch", "vite"]);
  });
  it("fails malformed audit output instead of silently treating it as clean", () => {
    expect(() => evaluateAudit({ error: {} }, { packages: {} })).toThrow();
    expect(() => evaluateAudit({}, { packages: {} })).toThrow();
  });
});
