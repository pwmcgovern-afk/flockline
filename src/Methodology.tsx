import { ArrowLeft, Bird, Database, ExternalLink, Info, MessageCircle, Sparkles } from "lucide-react";

// A standalone content page reached at /#methodology. It consolidates how
// Flockline works and, more importantly, how to read the data honestly.
export default function Methodology() {
  return (
    <main className="methodology-page">
      <div className="methodology-col">
        <header className="methodology-head">
          <a className="methodology-back" href="#">
            <ArrowLeft size={16} />
            Back to the map
          </a>
          <div className="methodology-brand">
            <span className="methodology-mark">
              <Bird size={16} />
            </span>
            Flockline
          </div>
        </header>

        <p className="methodology-eyebrow">How it works</p>
        <h1>Methodology</h1>
        <p className="methodology-lede">
          Flockline is a live map of recent bird activity across the US Northeast, drawn entirely from eBird. This
          page explains where the data comes from, how to read it, and the honest limits of what a sightings map can
          tell you.
        </p>

        <section className="methodology-section">
          <h2>Where the data comes from</h2>
          <p>
            Every sighting on Flockline comes from{" "}
            <a href="https://ebird.org" target="_blank" rel="noreferrer">
              eBird <ExternalLink size={12} />
            </a>
            , the citizen-science database run by the Cornell Lab of Ornithology. Birders submit checklists of what
            they saw and where. Flockline reads that data live through the eBird API, so the map reflects what people
            have actually reported in the last few days, not a fixed dataset.
          </p>
        </section>

        <section className="methodology-section">
          <h2>How sightings are plotted</h2>
          <p>
            You pick a species, the states to include, and how many days back to look. Each dot is a location where
            that species was recently reported, colored by how recent the report is (blue is older, gold is mid,
            red is freshest).
          </p>
          <p className="methodology-callout">
            <Info size={16} />
            <span>
              eBird's live feed returns <strong>one record per location</strong>: the most recent report from each
              spot. So a dot count is the number of distinct locations a bird turned up at, not the number of
              checklists or the number of individual birds.
            </span>
          </p>
        </section>

        <section className="methodology-section">
          <h2>The timeline</h2>
          <p>
            The scrubber animates movement over your chosen window, and the two modes answer different questions:
          </p>
          <ul>
            <li>
              <strong>Trail</strong> shows every location reported through the selected day, colored by recency. It is
              the full picture of where a species has been.
            </li>
            <li>
              <strong>New</strong> shows only the locations whose freshest report is the selected day, so you can
              watch fresh detections appear day by day. The bars above the scrubber count those new detections.
            </li>
          </ul>
        </section>

        <section className="methodology-section">
          <h2>What the numbers mean</h2>
          <ul>
            <li>
              <strong>On map</strong>: locations currently plotted for your view.
            </li>
            <li>
              <strong>In window</strong>: total reporting locations across the whole lookback window.
            </li>
            <li>
              <strong>Birds</strong>: the sum of the counts birders entered (how many individuals), where they gave a
              number.
            </li>
            <li>
              <strong>States</strong>: how many of the selected states had a report.
            </li>
          </ul>
        </section>

        <section className="methodology-section methodology-flag">
          <h2>Read the data honestly</h2>
          <p>This is the part worth internalizing. A sightings map reflects birder effort, not bird abundance.</p>
          <ul>
            <li>
              <strong>Common birds are under-reported.</strong> Many birders do not bother logging crows, robins,
              starlings, gulls, or pigeons. The map shows far fewer dots than where these birds actually are. Treat
              counts for ubiquitous species as a floor, never a total.
            </li>
            <li>
              <strong>"Reviewed" is not a quality score.</strong> eBird manually vets only flagged or locally rare
              reports. Common-bird records are auto-accepted and stay unreviewed, so a low reviewed share is normal,
              not a problem.
            </li>
            <li>
              <strong>Coverage is uneven.</strong> Well-birded hotspots and weekends produce more reports than remote
              areas and weekdays. Empty space on the map often means nobody was looking, not that nothing was there.
            </li>
            <li>
              <strong>Provisional reports.</strong> Including unconfirmed reports adds recent sightings that have not
              been validated yet. Toggle it off to see only confirmed records.
            </li>
          </ul>
        </section>

        <section className="methodology-section">
          <h2>
            <Sparkles size={18} />
            Insights
          </h2>
          <p>
            The Insights panel surfaces the rarest and most notable birds reported across New England in the past two
            weeks, pulled from eBird's notable-observations feed. When an Anthropic API key is configured, Claude
            (claude-opus-4-8) writes the short summaries; otherwise Flockline falls back to plain templated text. In
            both cases the species, places, dates, and checklist links come straight from eBird. The model only
            phrases what the data already says, and it is given the exact records so it cannot invent a sighting.
          </p>
        </section>

        <section className="methodology-section">
          <h2>
            <MessageCircle size={18} />
            Ask
          </h2>
          <p>
            The Ask assistant answers questions about birds and their recent activity. It is grounded: it queries the
            live eBird API through tools (species lookups, recent and notable sightings, sightings near a point)
            rather than answering from memory, so it will not fabricate sightings, counts, or locations. When you ask
            to see a bird, it can load that species onto the map and zoom to a real reported spot.
          </p>
        </section>

        <section className="methodology-section">
          <h2>
            <Database size={18} />
            Freshness
          </h2>
          <p>
            Results are cached for about five minutes so the map stays quick. The refresh button up in the header
            forces a live re-pull from eBird, bypassing that cache, when you want the very latest.
          </p>
        </section>

        <section className="methodology-section">
          <h2>Attribution and limits</h2>
          <p>
            Flockline is a viewer for public eBird data and is not affiliated with eBird or the Cornell Lab of
            Ornithology. It is meant for exploration and casual planning, not as a scientific survey. Sighting data is
            &copy; eBird and its contributors. For the authoritative record, explore{" "}
            <a href="https://ebird.org" target="_blank" rel="noreferrer">
              eBird <ExternalLink size={12} />
            </a>
            .
          </p>
        </section>

        <footer className="methodology-foot">
          <a className="methodology-back" href="#">
            <ArrowLeft size={16} />
            Back to the map
          </a>
        </footer>
      </div>
    </main>
  );
}
