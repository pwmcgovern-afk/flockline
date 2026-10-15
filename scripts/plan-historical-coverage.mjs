import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { createHistoricalCoveragePlan } from "../lib/historicalCoveragePlan.js";

const { values } = parseArgs({ options: Object.fromEntries([
  "counties", "states", "pooled", "annual", "start-year", "end-year", "created-at", "output",
].map((name) => [name, { type: "string" }])) });
for (const name of ["counties", "states", "pooled", "annual", "start-year", "end-year", "created-at", "output"]) {
  if (!values[name]) throw new Error(`Missing --${name}`);
}
const [counties, states, pooled, annual] = await Promise.all(["counties", "states", "pooled", "annual"]
  .map(async (name) => JSON.parse(await fs.readFile(values[name], "utf8"))));
const plan = createHistoricalCoveragePlan({ counties, states, pooled, annual,
  startYear: Number(values["start-year"]), endYear: Number(values["end-year"]), createdAt: values["created-at"] });
await fs.writeFile(values.output, JSON.stringify(plan, null, 2) + "\n");
console.log(JSON.stringify(plan.totals));
