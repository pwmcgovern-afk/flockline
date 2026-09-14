# Newsletter and Insights discovery

September 13, 2026.

The map's welcome card offers notable sightings before asking visitors to choose a species. Opening a panel hides the welcome card. Insights gives its first finding a stronger visual treatment and links directly to newsletter signup with the current regional edition.

The weekly roundup introduction shows a saved issue before the fresh-generation region choices. Its signup invitation sits directly below that sample. The newsletter landing page pairs the same sample with the regional signup form on desktop and offers a jump to signup on phones. Archive issues also offer signup near the top.

## Content and behavior

- `LatestIssuePreview.tsx` reads `/api/roundup-archive?scope=…`. Viewing a sample never calls the generation or email endpoints.
- The preview shows the actual issue date and links to its permanent dated URL. It selects the first illustrated finding, falling back to the first finding without an image. It does not invent sightings or label older issues as this week's news.
- Artwork retains the species-illustration disclaimer. Titles and locations come directly from the saved issue.
- If the image host fails, the preview removes the broken illustration and keeps the issue title, location, date, and link readable.
- Changing the preview edition updates the signup default until the visitor edits their subscription choices. After that, their chosen subscriptions remain intact.
- Aborted requests cannot replace a newer region's sample. Missing or failed samples offer the archive link while the signup form remains usable.
- Signup still requires email confirmation. The button describes the benefit, and the adjacent explanation tells readers that confirmation comes first.
- Newsletter links from Insights use `src=insights`; archive invitations use `src=roundup-issue`. Existing attribution is passed through to the signup API.
- Styling lives in `src/discovery.css` and uses the existing typefaces, paper backgrounds, ink colors, and red accent. No dependencies or delivery logic were added.

## Verification

Run `npm run check`, `npm run test:ui`, and `npm run test:ui:webkit`. The browser suite intercepts API calls so signup checks cannot send mail. New scenarios cover phone discovery through regional signup, dated preview links, missing previews, region request races, and preservation of edited preferences. Phone geometry checks wait for the drawer animation's final painted layout before taking measurements.

Manual checks: map entry, Insights, roundup preview, newsletter sample and signup shortcut on desktop and phone; opening the dated sample; image disclaimers; no horizontal overflow at 320px. Confirm production is serving the merged commit before considering the work shipped.
