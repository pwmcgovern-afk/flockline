import { ArrowLeft, ExternalLink } from "lucide-react";

// A standalone content page reached at /#methodology. It consolidates how
// Flockline works and, more importantly, how to read the data honestly.
export default function Methodology() {
  return (
    <main className="methodology">
      <div className="methodology-inner">
        <a className="back" href="#">
          <ArrowLeft />
          Back to the map
        </a>

        <header className="methodology-head">
          <span className="script">how to read</span>
          <h1>Flockline</h1>
        </header>

        <section>
          <h2>Where the data comes from</h2>
          <p>
            Every sighting comes from{" "}
            <a href="https://ebird.org" target="_blank" rel="noreferrer">
              eBird <ExternalLink size={12} />
            </a>
            , the citizen-science database run by the Cornell Lab of Ornithology. Birders submit
            checklists of what they saw and where. Flockline reads that data live through the eBird
            API, so the map reflects what people have actually reported in the last few days, not a
            fixed dataset.
          </p>
        </section>

        <section>
          <h2>Reading the map</h2>
          <p>
            Pick a species from the title at the top, a window from the presets at the left, and
            states from Menu. Each dot is a location where that species was recently reported,
            colored by how recent the report is: blue for older, gold for mid, red for freshest.
          </p>
          <div className="callout">
            <p>
              eBird's live feed returns <strong>one record per location</strong>, the most recent
              report from each spot. A dot count is the number of distinct locations a bird turned
              up at, not the number of checklists and not the number of individual birds.
            </p>
            <p>
              The <strong>birds</strong> figure beside it is a different thing: the sum of the
              counts birders actually typed in. Plenty of checklists record that a bird was present
              without saying how many, and those contribute nothing to it. So that number is a
              floor too, and always lower than the birds really out there.
            </p>
          </div>
        </section>

        <section>
          <h2>The timeline</h2>
          <p>
            The scrubber animates movement over your chosen window, and the two modes answer
            different questions.
          </p>
          <ul>
            <li>
              <strong>Trail</strong> shows every location reported through the selected day, colored
              by recency. It is the full picture of where a species has been.
            </li>
            <li>
              <strong>New</strong> shows only the locations whose freshest report is the selected
              day, so you can watch fresh detections appear day by day. The bars above the rail count
              those locations for every day in the window.
            </li>
          </ul>
        </section>

        <section>
          <h2>Choosing a region</h2>
          <p>
            Nationwide selects all 50 states plus Washington, D.C. in one step. The other four
            presets follow U.S. Census groupings: Northeast, Midwest, South, and West. Choosing one
            selects every state in it, and the state buttons refine that selection. Northeast is the
            first-visit default so older links still work, but the map, timeline, Insights, and Ask
            all work at every scale.
          </p>
        </section>

        <section>
          <h2>Read the data honestly</h2>
          <p>
            This is the part worth internalizing. A sightings map reflects birder effort, not bird
            abundance.
          </p>
          <ul>
            <li>
              <strong>Common birds are under-reported.</strong> Many birders do not bother logging
              crows, robins, starlings, gulls, or pigeons. The map shows far fewer dots than where
              these birds actually are. Treat counts for ubiquitous species as a floor, never a total.
            </li>
            <li>
              <strong>"Reviewed" is not a quality score.</strong> eBird manually vets only flagged or
              locally rare reports. Common-bird records are auto-accepted and stay unreviewed, so a
              low reviewed share is normal, not a problem.
            </li>
            <li>
              <strong>Coverage is uneven.</strong> Well-birded hotspots and weekends produce more
              reports than remote areas and weekdays. Empty space on the map often means nobody was
              looking, not that nothing was there.
            </li>
            <li>
              <strong>State requests can fail independently.</strong> Flockline loads a large region
              a few states at a time. If eBird is temporarily unavailable for one state, the
              successful states stay on the map and a partial-results notice names what is missing.
            </li>
            <li>
              <strong>Provisional reports.</strong> Including unconfirmed reports adds recent
              sightings that have not been validated yet. Toggle it off in Menu to see only confirmed
              records.
            </li>
          </ul>
        </section>

        <section>
          <h2>Insights</h2>
          <p>
            Insights summarize eBird's notable-observations feed. When an Anthropic API key is
            configured, Claude writes the short summaries; otherwise Flockline falls back to plain
            templated text. In both cases the species, places, dates, and checklist links come
            straight from eBird. The model only phrases what the data already says, and it is given
            the exact records so it cannot invent a sighting.
          </p>
          <h3>Scope and shareable links</h3>
          <p>
            Insights carry their own region and window, separate from the map. By default they follow
            whatever the map is showing; pick a region or a different window inside the panel and
            they stay pinned to it. The link button copies a URL that reopens Flockline directly on
            that exact view, so "rare birds in the West over the past three days" is one link.
          </p>
        </section>

        <section>
          <h2>My birds and field alerts</h2>
          <p>
            My birds is a device-local watchlist. Field alerts compare watched species against the
            current notable-sighting findings and appear inside the app. They are not push
            notifications and do not guarantee that every report will be surfaced. Watchlists, alert
            choices, preferred states, and filters stay in your browser and are not attached to an
            account.
          </p>
        </section>

        <section>
          <h2>Ask</h2>
          <p>
            The Ask assistant answers questions about birds and their recent activity. It is
            grounded: it queries the live eBird API through tools (species lookups, recent and
            notable sightings, sightings near a point) rather than answering from memory, so it will
            not fabricate sightings, counts, or locations. When you ask to see a bird, it can load
            that species onto the map and zoom to a real reported spot. Ask uses your selected states
            as its regional focus. If you say "near me" without naming a place, it asks for a town,
            park, ZIP code, or coordinates instead of assuming your location.
          </p>
        </section>

        <section>
          <h2>Freshness</h2>
          <p>
            Sightings are cached by state for about five minutes so the map stays quick and
            overlapping regional searches can reuse work. The refresh button in the top-right forces
            a live re-pull from eBird, bypassing that cache, when you want the very latest. Insights
            have a longer cache because they summarize a broader set of notable reports; the re-run
            button inside the panel forces a regenerate.
          </p>
        </section>

        <section>
          <h2>Privacy and shared links</h2>
          <p>
            Flockline does not require an account. Your active bird, states, timeline window,
            filters, open panel, and any pinned Insights scope are stored in the page URL so the view
            can be bookmarked or shared. No API credentials are ever stored in the browser. My birds
            and display preferences stay local to the device and are never sent with Ask questions.
            Questions submitted through Ask are sent to Flockline's server and to Anthropic to
            generate a response, so do not include personal or sensitive information in a birding
            question.
          </p>
        </section>

        <section>
          <h2>Attribution and limits</h2>
          <p>
            Flockline is a viewer for public eBird data and is not affiliated with eBird or the
            Cornell Lab of Ornithology. It is meant for exploration and casual planning, not as a
            scientific survey. Sighting data is &copy; eBird and its contributors. For the
            authoritative record, explore{" "}
            <a href="https://ebird.org" target="_blank" rel="noreferrer">
              eBird <ExternalLink size={12} />
            </a>
            .
          </p>
        </section>

        <footer className="methodology-foot">
          <a className="back" href="#">
            <ArrowLeft />
            Back to the map
          </a>
        </footer>
      </div>
    </main>
  );
}
