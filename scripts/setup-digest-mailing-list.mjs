import { config as loadEnvironment } from "dotenv";
import { Resend } from "resend";
import { DIGEST_REGIONS } from "../shared/digestRegions.js";

// `vercel env pull` writes .env.local. Load it first while still allowing a
// conventional .env file or an already-exported shell variable to fill gaps.
loadEnvironment({ path: ".env.local" });
loadEnvironment();

const apiKey = String(process.env.RESEND_API_KEY || "").trim();
if (!apiKey) {
  throw new Error("Set RESEND_API_KEY before running this setup script.");
}

const resend = new Resend(apiKey);
const segmentName = "Flockline weekly digest subscribers";
const existingSegments = await resend.segments.list({ limit: 100 });
if (existingSegments.error) {
  throw new Error(existingSegments.error.message);
}
let segment = existingSegments.data?.data?.find((item) => item.name === segmentName);
if (!segment) {
  const created = await resend.segments.create({ name: segmentName });
  if (created.error) throw new Error(created.error.message);
  segment = created.data;
}

const existingTopics = await resend.topics.list();
if (existingTopics.error) {
  throw new Error(existingTopics.error.message);
}

const output = [`RESEND_DIGEST_SEGMENT_ID=${segment.id}`];
for (const region of DIGEST_REGIONS) {
  const name = `Flockline ${region.name} weekly roundup`;
  let topic = existingTopics.data?.data?.find((item) => item.name === name);
  if (!topic) {
    const created = await resend.topics.create({
      name,
      description: `Rare and locally notable bird reports from the ${region.name} Flockline edition.`,
      defaultSubscription: "opt_out"
    });
    if (created.error) throw new Error(created.error.message);
    topic = created.data;
  }
  output.push(`${region.topicEnvironment}=${topic.id}`);
}

process.stdout.write(`${output.join("\n")}\n`);
