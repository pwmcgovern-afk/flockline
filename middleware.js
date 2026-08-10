import { buildMeta, escapeHtml } from "./shared/shareMeta.js";

/**
 * Every URL served the same title and preview card, so a link to an Osprey map
 * of the Northeast shared as the generic site description and every link
 * looked identical in a group chat. This is a single-page app, so there is no
 * per-route HTML to edit: the shell is rewritten to index.html for everything.
 * This intercepts the HTML response and rewrites the handful of tags that
 * matter, from the query string the link already carries.
 *
 * Assets, the API and index.html itself are excluded by the matcher, so the
 * fetch below reads the static shell without re-entering this function.
 */
export const config = {
  matcher: ["/((?!api/|assets/|.*\\.[a-zA-Z0-9]+$).*)"]
};

// Replaces the content of a tag matched by attribute, leaving the rest alone.
function setMeta(html, attribute, name, value) {
  const pattern = new RegExp(
    `(<meta\\s+[^>]*${attribute}=["']${name}["'][^>]*content=["'])[^"']*(["'])`,
    "i"
  );
  return html.replace(pattern, `$1${escapeHtml(value)}$2`);
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const shell = await fetch(new URL("/index.html", url.origin), {
    headers: { "x-flockline-shell": "1" }
  });
  if (!shell.ok) {
    // Never let a metadata rewrite be the reason the app fails to load.
    return undefined;
  }

  const { title, description } = buildMeta(url);
  let html = await shell.text();
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = setMeta(html, "name", "description", description);
  html = setMeta(html, "property", "og:title", title);
  html = setMeta(html, "property", "og:description", description);
  html = setMeta(html, "property", "og:url", url.href);
  html = setMeta(html, "name", "twitter:title", title);
  html = setMeta(html, "name", "twitter:description", description);

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Crawlers and repeat visitors hit the edge copy; the shell itself is
      // static, so only the injected tags vary and they vary only by URL.
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
    }
  });
}
