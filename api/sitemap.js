import {
  archiveConfigured,
  listArchivedRoundups,
} from "../lib/roundupArchive.js";

export default async function handler(request, response) {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.setHeader("Allow", "GET, HEAD");
    return response.status(405).end();
  }
  try {
    if (!archiveConfigured()) throw new Error("Archive storage unavailable");
    const issues = await listArchivedRoundups();
    const paths = [
      "/",
      "/newsletter",
      "/methodology",
      "/roundup",
      ...issues.map(({ scopeId, date }) => `/roundup/${scopeId}/${date}`),
    ];
    // No invented lastmod dates: saved issue dates describe publication, not
    // subsequent illustration changes. New issues appear without a deployment.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>https://flockline.app${path}</loc></url>`).join("")}</urlset>`;
    response.setHeader("Content-Type", "application/xml; charset=utf-8");
    response.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
    );
    return response.status(200).send(request.method === "HEAD" ? "" : xml);
  } catch (error) {
    console.error("Sitemap archive read failed", error.message);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Retry-After", "60");
    return response.status(503).send("Sitemap temporarily unavailable");
  }
}
