import { ArrowLeft, ArrowRight } from "lucide-react";
import DigestSignup from "./DigestSignup";
import LatestIssuePreview from "./LatestIssuePreview";
import { useState } from "react";
import { US_REGION_PRESETS } from "../shared/usGeography.js";

// The linkable front door for the weekly digest, served at /newsletter. Every
// promotion channel points here with a ?src= slug so signups can be attributed.
// Accept the URL from the server renderer, or use the browser location after
// startup. Neither path changes signup attribution or the selected edition.
export default function NewsletterPage({ search = typeof window === "undefined" ? "" : window.location.search }: { search?: string }) {
  const params = new URLSearchParams(search);
  const signupSrc = (params.get("src") || "newsletter").trim().toLowerCase();
  const regionParam = (params.get("region") || "").trim().toLowerCase();
  const defaultRegion = US_REGION_PRESETS.some((region) => region.id === regionParam) ? regionParam : "nationwide";
  const [previewRegion, setPreviewRegion] = useState(defaultRegion);
  return (
    <main className="methodology newsletter-page">
      <div className="methodology-inner">
        <a className="back" href="/">
          <ArrowLeft />
          Back to the map
        </a>

        <header className="methodology-head">
          <span className="script">the Flockline weekly digest</span>
          <h1>Six remarkable birds.<br />One Monday email.</h1>
        </header>

        <p className="newsletter-lede">
          Find out what showed up, where it was seen, and why it caught our attention.
          Six notable species from verified eBird reports in your region, with illustrations,
          original checklists, and links to explore the map.
        </p>

        <p className="newsletter-promise">Free · Every Monday at 10 AM ET · Unsubscribe anytime</p>
        <a className="newsletter-jump" href="#subscribe">Get the free digest <ArrowRight size={15} aria-hidden="true" /></a>

        <div className="newsletter-showcase">
          <div className="newsletter-sample">
            <label className="newsletter-edition">
              <span>Take a look inside</span>
              <select aria-label="Preview an edition" value={previewRegion} onChange={(event) => setPreviewRegion(event.target.value)}>
                {US_REGION_PRESETS.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
              </select>
            </label>
            <LatestIssuePreview regionId={previewRegion} />
          </div>
          <div id="subscribe" className="newsletter-form" tabIndex={-1}>
            <DigestSignup defaultRegionId={previewRegion} src={signupSrc} startOpen />
          </div>
        </div>

        <section>
          <h2>What's inside</h2>
          <ul>
            <li>
              <strong>Six notable species</strong> for your chosen region: rarities, birds far out
              of range, and unusual runs, each with the location, date, and count as reported.
            </li>
            <li>
              <strong>A live map link for every bird</strong>, so one click shows everywhere it has
              been reported in the past week.
            </li>
            <li>
              <strong>The eBird checklist behind each report</strong>, because the original record
              is always the authoritative one.
            </li>
          </ul>
          <p>
            Editions cover the whole U.S. plus the Northeast, Midwest, South, and West. Pick as
            many as you like; each arrives as its own email.
          </p>
        </section>

        <section>
          <h2>Read a recent issue first</h2>
          <p>
            Every issue is published on the web, so you can see exactly what you are signing up
            for.{" "}
            <a href="/roundup">
              Browse the roundup archive <ArrowRight size={12} />
            </a>
          </p>
        </section>

        <section>
          <h2>The honest fine print</h2>
          <p>
            Sightings come from eBird, the Cornell Lab of Ornithology's citizen-science database,
            and reflect what birders reported, not a population survey. Flockline only phrases what
            the verified records already say; it never invents a sighting. The{" "}
            <a href="/methodology">methodology page</a> spells out how to read the data. Signup is
            double opt-in, every email has a one-click unsubscribe, and your address is used for
            nothing else.
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
