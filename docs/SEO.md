# Flockline search setup

Implemented September 7, 2026.

## Public pages

- `/`: interactive bird map, canonicalized across query-string filter variants.
- `/newsletter`: regional signup page. Query parameters still select editions and preserve signup attribution.
- `/methodology`: explanation of the data and its limits. Old `/#methodology` bookmarks still work.
- `/roundup`: crawlable index of every saved weekly issue.
- `/roundup/{region}/{date}`: full saved article in initial HTML, with its own title, description, canonical, Article and breadcrumb structured data.
- `/roundup/{region}`: temporary redirect to the latest saved issue, so Google indexes its permanent dated URL.

The sitemap at `/sitemap.xml` reads the archive, includes only actual published issues and the four main pages, and updates without a deployment. It currently lists 19 URLs (15 issues). Missing pages and invalid dates return HTTP 404 and noindex. Archive outages return uncached HTTP 503, not an empty index. No fabricated modification dates or speculative species/location pages are published.

## Implementation

`npm run build` builds the browser assets and the server-only `src/seo-entry.tsx` renderer. `api/page.js` reads the built HTML template and renders the same newsletter, archive, and methodology React components used by the browser. Initial archive data is safely serialized for the client, avoiding a second request or a loading flash. The map is loaded separately so editorial pages do not download its JavaScript. The map still requires JavaScript, with descriptive initial HTML for readers and crawlers.

The ordered `routes` in `vercel.json` send `/` to the renderer before Vercel's filesystem phase. This is necessary because a normal fallback rewrite gives the static `index.html` precedence at `/`, skipping query-specific share metadata and server-rendered content. Assets and APIs keep their normal filesystem handling. `www` redirects permanently to the apex; `/index.html` redirects to `/`. Preview HTML carries an HTTP noindex header.

The new renderer replaces the previous edge metadata middleware and does not fetch the deployment's HTML over HTTP. This also removes the obsolete Edge runtime configuration warning. The production function includes `dist/index.html` and the server bundle explicitly.

## Google Search Console

The domain property `sc-domain:flockline.app` was verified in Pat's existing Google Search Console account on September 7, 2026, using a DNS TXT record. Keep the `google-site-verification` record at the apex; it preserves verified ownership. Hosting and email records were not replaced.

Submit `https://flockline.app/sitemap.xml` in this property's Sitemaps report after deployment. Use URL Inspection to check the homepage and a dated issue. A new property initially reports that data is processing. Sitemap acceptance and URL submission do not guarantee indexing or rankings.

## Validation

- Unit tests cover metadata, canonical URLs, server-rendered article/index content, safe HTML/JSON escaping, missing-page directives, and sitemap failure handling.
- The existing 13 browser scenarios cover signup, navigation, search, map state, archives, keyboard focus, and Ask.
- Preview HTTP checks verified actual archived text, 19 sitemap URLs, asset MIME types, latest-issue redirects, and real 404 responses.
- Chrome verified the archive and newsletter, including West edition selection via the query string.

## References

- [Google JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Vercel routing configuration](https://vercel.com/docs/project-configuration/vercel-json)
