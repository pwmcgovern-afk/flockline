import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  archiveConfigured,
  getArchivedRoundup,
  listArchivedRoundups,
} from "../lib/roundupArchive.js";
import { parseArchivePath, renderPage } from "../server-render/seo-entry.js";

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
    if (path.startsWith("/roundup")) {
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
    status = 503;
    response.setHeader("Retry-After", "60");
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader(
    "X-Robots-Tag",
    status === 200 && process.env.VERCEL_ENV !== "preview"
      ? "index, follow"
      : "noindex",
  );
  response.setHeader(
    "Cache-Control",
    status === 200
      ? "public, max-age=0, s-maxage=300, stale-while-revalidate=3600"
      : "no-store",
  );
  const html = renderPage(template, url, initial, status);
  return response.status(status).send(request.method === "HEAD" ? "" : html);
}
