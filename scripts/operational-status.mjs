import { OPERATIONAL_ENVIRONMENTS, OPERATIONAL_ROUTES, readOperationalSnapshots } from "../lib/operationalEvents.js";

const usage = "Usage: node scripts/operational-status.mjs [--environment production|preview|development] [--days 1..14] [--route chat|insights|sighting|roundup]";
try {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!["--environment", "--days", "--route"].includes(name) || value === undefined || options[name.slice(2)] !== undefined) throw new Error(usage);
    options[name.slice(2)] = name === "--days" && /^\d+$/.test(value) ? Number(value) : value;
  }
  if ((options.environment !== undefined && !OPERATIONAL_ENVIRONMENTS.includes(options.environment))
    || (options.route !== undefined && !OPERATIONAL_ROUTES.includes(options.route))
    || (options.days !== undefined && (!Number.isInteger(options.days) || options.days < 1 || options.days > 14))) throw new Error(usage);
  const result = await readOperationalSnapshots(options);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.failedReads ? 1 : 0;
} catch (error) {
  // Provider exceptions can include request URLs or credentials. Print only
  // our fixed usage text or an operational category, never their messages.
  console.error(error?.message === usage ? usage : "Operational samples could not be read. Check Blob access and try again.");
  process.exitCode = 1;
}
