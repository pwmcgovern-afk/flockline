import { repairMissingDigestArchive } from "../lib/digestArchiveRepair.js";

const args = process.argv.slice(2);
const allowed = new Set(["--date", "--region", "--apply"]);
const options = {};
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (!allowed.has(argument) || Object.hasOwn(options, argument)) throw new Error("Invalid or repeated argument.");
  options[argument] = argument === "--apply" ? true : args[++index];
}
if (!options["--date"] || !options["--region"]) {
  throw new Error("Usage: node scripts/repair-missing-digest-archive.mjs --date YYYY-MM-DD --region REGION [--apply]");
}
const result = await repairMissingDigestArchive({
  date: options["--date"], regionId: options["--region"], apply: options["--apply"] === true,
});
console.log(JSON.stringify(result, null, 2));
