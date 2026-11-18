# Dependency audit

As of November 17, 2026, [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) affects all published picomatch versions through 4.0.7. There is no verified patched release. The linked upstream PR #194 explicitly says it does not fix the general single-branch repeated-extglob problem. Do not describe a version bump or that PR as a fix.

Flockline's locked picomatch and affected dependency chain (fdir, tinyglobby, Vite, Vitest, and the React build plugin) are development dependencies. They handle repository-controlled build/test glob patterns. They are not part of the public request handlers or a service accepting user-supplied glob patterns. This limits exposure but does not fix the upstream vulnerability.

CI runs the full npm audit JSON report through scripts/audit-dependencies.mjs. A narrowly documented exception permits only this exact advisory and development-only dependency chains whose every cause leads to it. Every reported install path must be marked dev:true in the lockfile. The same advisory in a production scope, an unrelated high/critical finding, unknown install scope, missing cause, failed audit execution, or malformed report still fails. The exception is visible in CI output.

Replace the exception with a verified patched release when one is published. Reassess immediately if glob patterns become user-controlled or the dependency enters production scope. The focused guard tests cover accepted and rejected evidence; no clean full-audit claim is made while the exception remains.
