import { ArrowLeft, ArrowRight } from "lucide-react";
import DigestSignup from "./DigestSignup";
import { US_REGION_PRESETS } from "../shared/usGeography.js";

// The linkable front door for the weekly digest, served at /newsletter. Every
// promotion channel points here with a ?src= slug so signups can be attributed.
// Read the URL once at module evaluation: this page never mounts <App/>, so
// nothing rewrites the address bar, but a single read keeps it simple.
const params = new URLSearchParams(window.location.search);
const SIGNUP_SRC = (params.get("src") || "newsletter").trim().toLowerCase();
const REGION_PARAM = (params.get("region") || "").trim().toLowerCase();
const DEFAULT_REGION = US_REGION_PRESETS.some((region) => region.id === REGION_PARAM)
  ? REGION_PARAM
  : "nationwide";

export default function NewsletterPage() {
  return (
    <main className="methodology newsletter-page">
      <div className="methodology-inner">
        <a className="back" href="/">
          <ArrowLeft />
          Back to the map
        </a>

        <header className="methodology-head">
          <span className="script">every monday</span>
          <h1>The week in rare birds, by email</h1>
        </header>

        <p className="newsletter-lede">
          Flockline reads every verified notable sighting reported to eBird over the past seven
          days and sends you the six most interesting ones for your region: what showed up, where,
          and a live map for each. Free, no account, one email every Monday at 10 AM Eastern.
        </p>

        <DigestSignup defaultRegionId={DEFAULT_REGION} src={SIGNUP_SRC} startOpen />

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
            <a href="/#methodology">methodology page</a> spells out how to read the data. Signup is
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
