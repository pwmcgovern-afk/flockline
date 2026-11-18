import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// No patched release exists for this advisory as of November 17, 2026.
// Only the locked, development-only Vite/Vitest chain is excepted. A runtime
// occurrence or any unrelated high/critical advisory still fails the gate.
export const DEVELOPMENT_ADVISORY = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";

export function evaluateAudit(audit, lock) {
  if (audit.error || !audit.vulnerabilities || !lock.packages)
    throw new Error("Dependency audit did not return a valid report and lockfile");
  const vulnerabilities = audit.vulnerabilities;
  function isDevelopmentException(name, ancestors = new Set()) {
    if (ancestors.has(name)) return false;
    const finding = vulnerabilities[name];
    if (!finding || !finding.nodes?.length || !finding.via?.length) return false;
    if (!finding.nodes.every((path) => lock.packages[path]?.dev === true)) return false;
    const next = new Set(ancestors).add(name);
    return finding.via.every((cause) =>
      typeof cause === "string"
        ? isDevelopmentException(cause, next)
        : cause.name === "picomatch" && cause.url === DEVELOPMENT_ADVISORY
    );
  }
  const blocked = [];
  const excepted = [];
  for (const [name, finding] of Object.entries(vulnerabilities)) {
    if (!["high", "critical"].includes(finding.severity)) continue;
    (isDevelopmentException(name) ? excepted : blocked).push(name);
  }
  return { blocked, excepted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync("npm", ["audit", "--json"], { encoding: "utf8" });
  try {
    if (result.error || result.status === null || ![0, 1].includes(result.status))
      throw new Error(result.error?.message || "npm audit failed to run");
    const decision = evaluateAudit(
      JSON.parse(result.stdout),
      JSON.parse(readFileSync("package-lock.json", "utf8")),
    );
    if (decision.excepted.length)
      console.warn(`Known unpatched development advisory ${DEVELOPMENT_ADVISORY}: ${decision.excepted.join(", ")}. See docs/DEPENDENCY_AUDIT.md.`);
    if (decision.blocked.length) {
      console.error(`Unexcepted high/critical dependency findings: ${decision.blocked.join(", ")}`);
      console.error(result.stdout);
      process.exitCode = 1;
    } else {
      console.log("Dependency gate passed; no unexcepted high/critical findings.");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
