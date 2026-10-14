import { ArrowLeft, ExternalLink } from "lucide-react";

// A standalone content page reached at /methodology. It consolidates how
// Flockline works and, more importantly, how to read the data honestly.
export default function Methodology() {
  return (
    <main className="methodology">
      <div className="methodology-inner">
        <a className="back" href="/">
          <ArrowLeft />
          Back to the map
        </a>

        <header className="methodology-head">
          <span className="script">how to read</span>
          <h1>How Flockline uses eBird sightings</h1>
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
              The <strong>reported count</strong> sums the supplied numeric counts on each
              location's latest report. Reports without counts remain on the map but are omitted
              from that sum. Reports can overlap or miss birds, so this is neither a count of
              distinct birds nor a reliable lower bound on the population.
            </p>
          </div>
        </section>

        <section>
          <h2>The timeline</h2>
          <p>
            The scrubber filters the latest report from each location by date. It does not track
            individual birds or reconstruct their movement. The two modes show different views
            of those same records.
          </p>
          <ul>
            <li>
              <strong>Trail</strong> shows locations whose latest report falls on or before the
              selected day, colored by recency. Earlier reports at the same location are not
              included in this feed.
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
            selects every state in it, and the state buttons refine that selection. First visits
            start Nationwide, and links that name a region or states open exactly that selection.
            The map, timeline, Insights, and Ask all work at every scale.
          </p>
          <p>
            The nationwide map feed sometimes omits a report's state. Its coordinates still place
            it on the map, but Flockline shows “State not supplied” instead of guessing from a nearby
            state. State-specific requests provide that context. Ask can also recover a public
            hotspot's state from eBird's exact location record.
          </p>
        </section>

        <section>
          <h2>Read the data honestly</h2>
          <p>
            These reports reflect where birds were detected and where people looked. They are
            not a population survey.
          </p>
          <ul>
            <li>
              <strong>Reports are observations.</strong> Species differ in how easily they can be
              found and identified. Counts also depend on time spent looking, habitat, weather,
              and the number of observers.
            </li>
            <li>
              <strong>Review status is separate from rarity.</strong> Records can be accepted by
              eBird without individual review. A flagged report may await review, and an accepted
              report does not establish that a species is rare across an entire region.
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
              <strong>Provisional reports.</strong> Including provisional reports adds sightings
              that eBird has not marked valid. Toggle it off in Menu to request only records marked
              valid. Validity does not mean every record was individually reviewed.
            </li>
          </ul>
        </section>

        <section>
          <h2>Insights</h2>
          <p>
            Insights and weekly roundups select reports from eBird's notable-observations feed.
            A report is flagged in its local and date-specific context; the species may be an
            expected seasonal visitor or familiar elsewhere. Flockline uses recency and geographic
            variety to select reports. Historical context is shown where a county baseline is
            available; it does not rank biological rarity. Short summaries use factual templates, not generated interpretations, and
            preserve the source's review status when available.
          </p>
          <p>
            Report counts come from distinct eBird checklists. Flockline groups reports of the
            same species at the same place and start time to reduce duplicate copies of shared
            checklists. This feed does not include eBird's shared-group identifier, so the grouping
            is an estimate, not a count of independent sightings. Different groups can still report
            the same birds. A bird count beside a place belongs to the featured checklist.
          </p>
          <p>
            Nationwide Insights uses one bounded country feed so a useful selection loads quickly.
            If eBird's result limit is reached, the panel says that coverage and report totals are
            incomplete. Weekly roundups make additional state requests to extend coverage; they
            still disclose failures and limits. Neither selection is an exhaustive alert service.
          </p>
          <h3>Scope and shareable links</h3>
          <p>
            Insights carry their own region and window, separate from the map. By default they follow
            whatever the map is showing; pick a region or a different window inside the panel and
            they stay pinned to it. The link button copies a URL that reopens Flockline directly on
            that exact view, so "notable reports in the West over the past three days" is one link.
          </p>
        </section>

        <section id="historical-context">
          <h2>Historical context</h2>
          <p>
            The initial pilot covers San Francisco County using eBird's official histogram
            download for 2016–2025. For each featured report, Flockline looks up that species in
            the county and seasonal period of the observation. The percentage is the share of
            complete checklists reporting the species, with all complete checklists in that
            period supplying the denominator. It is not calculated from the recent notable feed.
          </p>
          <p>
            eBird exports four periods per month: days 1–7, 8–14, 15–21 and 22 through month end.
            We show the percentage, complete-checklist sample size, years and county together.
            A county average does not describe every habitat or hotspot. Low reporting frequency
            alone does not mean rare: seasonal visitors and habitat specialists may be expected
            despite appearing on a small share of county checklists.
          </p>
          <p>
            The pooled export cannot establish recurrence across individual years or whether a
            flock count is unusual. Sample size is descriptive; it is not a calibrated confidence
            score. Reporting also depends on observer effort and repeated visits to known birds.
            Missing counties or species are labelled unavailable, never treated as zero. Only
            baselines ending before the observation year are used. Broader coverage and annual
            recurrence require additional historical imports and validation.
          </p>
          <p>
            Source data © eBird and its contributors. See the{" "}
            <a href="https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-075" target="_blank" rel="noreferrer">pilot source chart</a>,{" "}
            <a href="https://support.ebird.org/en/support/solutions/articles/48001255130-ebird-bar-charts-and-graphs" target="_blank" rel="noreferrer">eBird's frequency explanation</a>{" "}
            and <a href="https://www.birds.cornell.edu/home/ebird-data-access-terms-of-use/" target="_blank" rel="noreferrer">data terms</a>.
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
            designed to use the live eBird API through tools for species lookups, recent and
            notable sightings, and sightings near a point. AI answers can still contain mistakes;
            check the linked source before relying on a sighting or interpretation. When you ask
            to see a bird, it can load that species onto the map and zoom to a reported spot.
            Ask uses your selected states
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
            button inside the panel refreshes the selection.
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
            question. If you subscribe to a weekly roundup, your email address and selected regional
            editions are stored by Resend for delivery. Flockline sends a confirmation link before
            adding the address, and every digest includes controls to change editions or unsubscribe.
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
          <a className="back" href="/">
            <ArrowLeft />
            Back to the map
          </a>
        </footer>
      </div>
    </main>
  );
}
