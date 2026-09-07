import { renderToString } from "react-dom/server";
import NewsletterPage from "./NewsletterPage";
import Methodology from "./Methodology";
import NotFound from "./NotFound";
import RoundupArchive, { type ArchiveInitial } from "./RoundupArchive";
import { parseArchivePath } from "./archivePath";
import { buildMeta, escapeHtml } from "../shared/shareMeta.js";

export { parseArchivePath };
const ORIGIN = "https://flockline.app";

// Only publish saved editorial pages. Map filter combinations stay shareable,
// but consolidate to the home page instead of creating thousands of thin URLs.
export function renderPage(
  template: string,
  url: URL,
  initial: ArchiveInitial = {},
  status = 200,
) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const canonical = `${ORIGIN}${path}`;
  const meta =
    status !== 200
      ? {
          title: "Page unavailable · Flockline",
          description:
            "Browse the Flockline bird map and weekly roundup archive.",
        }
      : path === "/methodology"
        ? {
            title: "How Flockline uses eBird sightings · Flockline",
            description:
              "Learn how Flockline maps eBird reports, how the timeline works, and what bird sightings can and cannot tell you.",
          }
        : buildMeta(url);
  if (initial.roundup) meta.description = initial.roundup.summary;

  const content =
    status === 404 ? (
      <NotFound />
    ) : status !== 200 ? (
      <main className="methodology">
        <div className="methodology-inner">
          <h1>Temporarily unavailable</h1>
          <p>
            Please try again shortly. <a href="/">Open the bird map</a>.
          </p>
        </div>
      </main>
    ) : path === "/newsletter" ? (
      <NewsletterPage search={url.search} />
    ) : path === "/methodology" ? (
      <Methodology />
    ) : path.startsWith("/roundup") ? (
      <RoundupArchive pathname={path} initial={initial} />
    ) : (
      <main className="methodology">
        <div className="methodology-inner">
          <h1>Flockline: live U.S. bird sightings</h1>
          <p>
            Explore recent eBird sightings across all 50 states and Washington,
            D.C. Pick a species, filter by region, and use the timeline to see
            where birds have been reported.
          </p>
          <p>
            The interactive map is loading. JavaScript is needed for map
            controls.
          </p>
          <nav aria-label="Explore Flockline">
            <a href="/roundup">Weekly birding roundups</a>
            {" · "}
            <a href="/newsletter">Free weekly birding newsletter</a>
            {" · "}
            <a href="/methodology">How to read the sightings data</a>
          </nav>
        </div>
      </main>
    );

  let html = template.replace(
    /<title>[^<]*<\/title>/i,
    () => `<title>${escapeHtml(meta.title)}</title>`,
  );
  function setMeta(attribute: string, name: string, value: string) {
    const pattern = new RegExp(
      `(<meta\\s+[^>]*${attribute}=["']${name}["'][^>]*content=["'])[^"']*(["'])`,
      "i",
    );
    html = html.replace(
      pattern,
      (_match, before, after) => `${before}${escapeHtml(value)}${after}`,
    );
  }
  setMeta("name", "description", meta.description);
  setMeta("property", "og:title", meta.title);
  setMeta("property", "og:description", meta.description);
  setMeta("property", "og:url", canonical);
  setMeta("name", "twitter:title", meta.title);
  setMeta("name", "twitter:description", meta.description);
  html = html.replace(
    /<link rel="canonical"[^>]*>/,
    () => `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
  );
  // A build marker avoids fragile nested-div matching when replacing the shell.
  html = html.replace(
    /<!--page-start-->[\s\S]*?<!--page-end-->/,
    () => `<div id="root">${renderToString(content)}</div>`,
  );
  const graph: Record<string, unknown>[] = [
    {
      "@type": "WebSite",
      "@id": `${ORIGIN}/#website`,
      name: "Flockline",
      url: `${ORIGIN}/`,
    },
  ];
  if (status === 200) {
    graph.push({
      "@type": initial.roundup ? "Article" : "WebPage",
      "@id": `${canonical}#page`,
      url: canonical,
      name: meta.title,
      description: meta.description,
      isPartOf: { "@id": `${ORIGIN}/#website` },
      ...(initial.roundup
        ? {
            headline: meta.title,
            datePublished: initial.roundup.generatedAt,
            author: { "@type": "Organization", name: "Flockline", url: ORIGIN },
            mainEntityOfPage: canonical,
          }
        : {}),
    });
    if (path.startsWith("/roundup"))
      graph.push({
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Flockline",
            item: `${ORIGIN}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Weekly roundups",
            item: `${ORIGIN}/roundup`,
          },
          ...(initial.roundup
            ? [
                {
                  "@type": "ListItem",
                  position: 3,
                  name: meta.title,
                  item: canonical,
                },
              ]
            : []),
        ],
      });
  }
  // Escaping '<' prevents saved content from terminating a JSON script element.
  const json = (value: unknown) =>
    JSON.stringify(value).replace(/</g, "\\u003c");
  html = html.replace(
    "</head>",
    () =>
      `<meta name="robots" content="${status === 200 ? "index, follow, max-image-preview:large" : "noindex"}" /><script type="application/ld+json">${json({ "@context": "https://schema.org", "@graph": graph })}</script></head>`,
  );
  html = html.replace(
    "</body>",
    () =>
      `<script id="flockline-page-data" type="application/json">${json({ ...initial, status })}</script></body>`,
  );
  return html;
}
