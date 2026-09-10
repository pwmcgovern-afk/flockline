# Mobile layout

Flockline uses the same URL, map state, API calls, saved birds and shared links
on phones and desktop. The phone header is in `src/MobileMapHeader.tsx` and its
layout rules are isolated in `src/mobile.css`. The desktop stylesheet and
header arrangement are preserved.

The mobile breakpoint includes screens up to 860px wide and short touch
screens in landscape. Keep the CSS query and `MOBILE_QUERY` in `src/App.tsx`
in sync.

- Direct region and lookback selectors, species search and a save button.
- Five labeled navigation buttons outside the map body's stacking context.
- Panels fill the available height above navigation. Covered map controls are
  inert, so keyboard focus cannot enter hidden content.
- Timeline details are collapsed initially. Opening them reveals playback,
  the day slider and the report histogram.
- Sighting records stay above navigation. Map closes the record.
- Search, signup and Ask adapt to the visual viewport's height and offset
  when a phone keyboard opens. Pinch zoom keeps the browser's native behavior.
- The introductory tour is available from the settings menu on phones.

## Verification

Run `npm run check`, `npm run test:ui` and `npm run test:ui:webkit`.
GitHub Actions installs Chromium and WebKit and runs all three commands.
Browser tests use local API and tile fixtures, so they cannot send mail or
consume eBird or AI requests.

September 9, 2026 verification:

- 140 unit tests, TypeScript and production builds pass.
- 19 Chromium browser scenarios, including touch at 320x568, 390x844 and
  932x430. Tests cover region/date changes, timeline, every panel, species
  search, actual marker taps, saved birds, rotation and keyboard viewport size.
- Six phone scenarios also pass in WebKit. Geometry assertions await the
  entry animation and its final painted frame.
- A separate offset viewport check places the visible area at y=100..480
  and verifies that search, its close button and signup remain inside it.
  This simulates the browser viewport API, not a physical OS keyboard.
- Clear map space on the 320x568 touch layout increases from about 45px to
  246px with the timeline collapsed. Browser tests require at least 180px.
- Desktop map and open-menu screenshots at 1440x900 match the original after
  tile paint and hover settle. Layout geometry also matches at 1024x768.
- No axe violations on the checked mobile map, signup and settings surfaces.

The dependency audit passes the existing high-severity threshold. It reports
two moderate findings in the existing Vitest development dependency chain;
production dependencies are unchanged by this layout work.
