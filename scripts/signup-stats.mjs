#!/usr/bin/env node
// Prints confirmed newsletter signups by channel (src) and by week, from the
// Blob event store written at confirmation time. This is the scoreboard for
// ranking promotion channels.
//
//   BLOB_READ_WRITE_TOKEN=... node scripts/signup-stats.mjs
//
// Locally, `vercel env pull` puts the token in .env and dotenv picks it up.
import "dotenv/config";
import { list } from "@vercel/blob";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set. Run `vercel env pull` first.");
  process.exit(1);
}

const events = [];
let cursor;
do {
  const page = await list({ prefix: "events/signup/", cursor, limit: 1000 });
  for (const blob of page.blobs || []) {
    try {
      const response = await fetch(blob.url);
      if (response.ok) {
        events.push(await response.json());
      }
    } catch {
      // A single unreadable event should not sink the report.
    }
  }
  cursor = page.cursor && page.hasMore ? page.cursor : undefined;
} while (cursor);

const confirmed = events.filter((event) => event.type === "confirmed");
console.log(`Confirmed signups: ${confirmed.length} (${events.length} events total)\n`);

const bySrc = tally(confirmed, (event) => event.src || "unknown");
console.log("By channel:");
for (const [src, count] of bySrc) {
  console.log(`  ${src.padEnd(20)} ${count}`);
}

const byWeek = tally(confirmed, (event) => isoWeek(event.at));
console.log("\nBy week:");
for (const [week, count] of [...byWeek].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${week.padEnd(20)} ${count}`);
}

function tally(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function isoWeek(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  // Thursday of the same ISO week determines the week's year and number.
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
