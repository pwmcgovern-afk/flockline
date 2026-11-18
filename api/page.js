import { enforceRateLimit } from "../lib/rateLimit.js";
import { ensureDailyDigest, getDailyDigest, listDailyDigests } from "../lib/dailyDigestArchive.js";
import { dailyDate, dailyDigestPath, parseDailyDigestPath } from "../shared/dailyDigest.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  archiveConfigured,
  getArchivedRoundup,
  listArchivedRoundups,
} from "../lib/roundupArchive.js";
import { parseArchivePath, renderPage } from "../server-render/seo-entry.js";

import { parseSightingPath } from "../shared/sightingPath.js";
import { getSightingDetails } from "../lib/sightingDetails.js";

let template;
export default async function handler(request, response) {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.setHeader("Allow", "GET, HEAD");
    return response.status(405).end();
  }
  template ??= await readFile(join(process.cwd(), "dist/index.html"), "utf8");
  const url = new URL(request.url, "https://flockline.app");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  let status = 200;
  let initial = {};
  try {
    if (path === "/digest" || path.startsWith("/digest/")) {
      const parsed = parseDailyDigestPath(path);
      if (!parsed.valid || (parsed.date && parsed.date > dailyDate())) status = 404;
      else if (!archiveConfigured()) throw new Error("Daily digest storage unavailable");
      else if (!parsed.scopeId) initial = { dailyIndex: { issues: await listDailyDigests() } };
      else if (!parsed.date) {
        response.setHeader("Location", dailyDigestPath(parsed.scopeId, dailyDate(), parsed.back));
        response.setHeader("Cache-Control", "no-store");
        return response.status(307).end();
      } else {
        let dailyDigest = await getDailyDigest(parsed.scopeId, parsed.date, parsed.back);
        if (!dailyDigest && parsed.date === dailyDate()) {
          if (!enforceRateLimit(request, response, { name: "daily-page-create", limit: 12, windowMs: 60 * 60 * 1000, message: "Too many new digest requests. Please try again later." })) return;
          // Generate the first edition before responding so a newly shared URL
          // already has complete server-rendered content and link metadata.
          dailyDigest = await ensureDailyDigest({ scopeId: parsed.scopeId, date: parsed.date, back: parsed.back });
        }
        if (dailyDigest) initial = { dailyDigest };
        else status = 404;
      }
    } else if (path.startsWith("/sightings")) {
      const address = parseSightingPath(path);
      if (!address) status = 404;
      else initial = { sighting: await getSightingDetails({ subId: address.subId, species: address.speciesCode }) };
    } else if (path.startsWith("/roundup")) {
      const parsed = parseArchivePath(path);
      if (!parsed.valid) status = 404;
      else {
        if (!archiveConfigured())
          throw new Error("Archive storage unavailable");
        if (!parsed.scopeId) {
          const issues = await listArchivedRoundups();
          initial = {
            index: {
              issues: issues.map(({ scopeId, date }) => ({ scopeId, date })),
            },
          };
        } else {
          const roundup = await getArchivedRoundup(parsed.scopeId, parsed.date);
          if (!roundup) status = 404;
          else if (!parsed.date) {
            // The undated convenience URL always resolves to the actual issue.
            response.setHeader(
              "Location",
              `/roundup/${parsed.scopeId}/${roundup.generatedAt.slice(0, 10)}${url.search}`,
            );
            response.setHeader(
              "Cache-Control",
              "public, max-age=0, s-maxage=300",
            );
            return response.status(307).end();
          } else initial = { roundup };
        }
      }
    } else if (!["/", "/newsletter", "/methodology"].includes(path))
      status = 404;
  } catch (error) {
    console.error("SEO page archive read failed", error.message);
    status = [404, 413].includes(error.statusCode) ? error.statusCode : 503;
    if (status === 413) initial = { dailyError: "This selection is too large to save. Choose a shorter report window." };
    response.setHeader("Retry-After", "60");
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader(
    "X-Robots-Tag",
    status === 200 && !initial.dailyPending && process.env.VERCEL_ENV !== "preview"
      ? "index, follow"
      : "noindex",
  );
  response.setHeader(
    "Cache-Control",
    status === 200 && !initial.dailyPending
      ? "public, max-age=0, s-maxage=300, stale-while-revalidate=3600"
      : "no-store",
  );
  const html = renderPage(template, url, initial, status);
  return response.status(status).send(request.method === "HEAD" ? "" : html);
}
