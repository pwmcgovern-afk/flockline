import { ArrowLeft, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import DigestSignup from "./DigestSignup";
import NotFound from "./NotFound";
import { parseArchivePath } from "./archivePath";
import { requestJson } from "./request";
import { US_REGION_PRESETS } from "../shared/usGeography.js";

// Public web archive of the weekly digest, served at /roundup (index),
// /roundup/{scope} (latest issue for a region), and /roundup/{scope}/{date}
// (one exact issue). Issues are persisted to Blob at send time and read back
// through /api/roundup-archive; this page is the shareable, indexable artifact
// each Monday's email leaves behind.

type ArchiveFinding = {
  kind?: string;
  title: string;
  detail: string;
  speciesCode?: string;
  comName?: string;
  locName?: string;
  obsDt?: string;
  howMany?: number | null;
  subId?: string;
  image?: { url?: string; alt?: string; kind?: string } | null;
};

type ArchiveRoundup = {
  scopeId: string;
  scopeLabel: string;
  generatedAt: string;
  summary: string;
  findings: ArchiveFinding[];
};

type ArchiveIndex = { issues: { scopeId: string; date: string }[] };

const REGION_NAMES = new Map<string, string>(
  US_REGION_PRESETS.map((region) => [region.id, region.name])
);

function formatIssueDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(parsed);
}

function kindLabel(kind?: string) {
  if (kind === "wide") return "Across the region";
  if (kind === "surge") return "Notable run";
  return "Rare report";
}

export default function RoundupArchive() {
  const { valid, scopeId, date } = parseArchivePath(window.location.pathname);
  if (!valid) return <NotFound />;
  return scopeId ? <IssueView scopeId={scopeId} date={date} /> : <IndexView />;
}

function IndexView() {
  const [index, setIndex] = useState<ArchiveIndex | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    requestJson<ArchiveIndex>("/api/roundup-archive?list=1", { signal: controller.signal })
      .then(({ response, body }) => {
        if (!response.ok || !Array.isArray(body.issues)) throw new Error();
        if (!controller.signal.aborted) setIndex(body);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("The archive could not be loaded right now.");
      });
    return () => controller.abort();
  }, [attempt]);

  const byRegion = US_REGION_PRESETS
    .map((region) => ({
      region,
      issues: (index?.issues || []).filter((issue) => issue.scopeId === region.id)
    }))
    .filter((entry) => entry.issues.length > 0);

  return (
    <main className="methodology archive-page">
      <div className="methodology-inner">
        <a className="back" href="/">
          <ArrowLeft />
          Back to the map
        </a>

        <header className="methodology-head">
          <span className="script">weekly roundups</span>
          <h1>The week in rare birds</h1>
        </header>

        <p className="newsletter-lede">
          Every Monday, Flockline distills the past week of verified eBird notable sightings into
          six findings per region. Each issue lives here permanently after it is sent.
        </p>

        <DigestSignup defaultRegionId="nationwide" src="roundup" />

        {error ? <p className="archive-status" role="alert">{error} <button type="button" className="pill" onClick={() => setAttempt((current) => current + 1)}>Try again</button></p> : null}
        {!error && index && byRegion.length === 0 ? (
          <p className="archive-status">
            The archive starts with the next Monday issue. Subscribe above and it will land in your
            inbox the moment it exists.
          </p>
        ) : null}
        {!error && !index ? <p className="archive-status">Loading issues…</p> : null}

        {byRegion.map(({ region, issues }) => (
          <section key={region.id}>
            <h2>{region.name}</h2>
            <ul className="archive-issue-list">
              {issues.map((issue) => (
                <li key={`${issue.scopeId}-${issue.date}`}>
                  <a href={`/roundup/${issue.scopeId}/${issue.date}`}>
                    Week ending {formatIssueDate(issue.date)}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}

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

function IssueView({ scopeId, date }: { scopeId: string; date: string | null }) {
  const [roundup, setRoundup] = useState<ArchiveRoundup | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setRoundup(null);
    const query = new URLSearchParams({ scope: scopeId });
    if (date) query.set("date", date);
    requestJson<ArchiveRoundup>(`/api/roundup-archive?${query.toString()}`, { signal: controller.signal })
      .then(({ response, body }) => {
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          setStatus("missing");
          return;
        }
        if (!response.ok || !Array.isArray(body.findings)) throw new Error();
        setRoundup(body);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [scopeId, date, attempt]);

  const regionName = REGION_NAMES.get(scopeId) || scopeId;

  return (
    <main className="methodology archive-page">
      <div className="methodology-inner">
        <a className="back" href="/roundup">
          <ArrowLeft />
          All roundups
        </a>

        <header className="methodology-head">
          <span className="script">
            {regionName} · {roundup ? `week ending ${formatIssueDate(roundup.generatedAt)}` : "weekly roundup"}
          </span>
          <h1>The week in rare birds</h1>
        </header>

        {status === "loading" ? <p className="archive-status">Loading this issue…</p> : null}
        {status === "missing" ? (
          <p className="archive-status">
            No archived issue exists there yet. <a href="/roundup">Browse the issues that do.</a>
          </p>
        ) : null}
        {status === "error" ? (
          <p className="archive-status" role="alert">The issue could not be loaded right now. <button type="button" className="pill" onClick={() => setAttempt((current) => current + 1)}>Try again</button></p>
        ) : null}

        {roundup ? (
          <>
            <p className="newsletter-lede">{roundup.summary}</p>

            {(roundup.findings || []).map((finding, position) => (
              <article className="archive-finding" key={`${finding.speciesCode || finding.title}-${position}`}>
                {finding.image?.url && finding.image.kind === "species-illustration" ? (
                  <figure className="archive-illustration">
                    <img src={finding.image.url} alt={finding.image.alt || finding.title} loading="lazy" />
                    <figcaption>Flockline species illustration · Not the reported individual.</figcaption>
                  </figure>
                ) : null}
                <span className="archive-kind">{kindLabel(finding.kind)}</span>
                <h2>{finding.title}</h2>
                <p>{finding.detail}</p>
                <p className="archive-meta">
                  {[finding.locName, finding.obsDt ? formatIssueDate(finding.obsDt) : "", Number.isFinite(finding.howMany) && (finding.howMany || 0) > 0 ? `${finding.howMany} ${finding.howMany === 1 ? "bird" : "birds"}` : ""].filter(Boolean).join(" · ")}
                </p>
                <p className="archive-links">
                  {finding.speciesCode ? (
                    <a href={`/?bird=${encodeURIComponent(finding.speciesCode)}&days=7&region=${encodeURIComponent(scopeId)}&mode=trail&provisional=1&hotspots=0`}>
                      View on the live map
                    </a>
                  ) : null}
                  {finding.subId ? (
                    <a href={`https://ebird.org/checklist/${encodeURIComponent(finding.subId)}`} target="_blank" rel="noreferrer">
                      eBird checklist <ExternalLink size={12} />
                    </a>
                  ) : null}
                </p>
              </article>
            ))}

            <section className="archive-signup">
              <h2>Get the next issue in your inbox</h2>
              <p>Free, every Monday at 10 AM Eastern, one click to unsubscribe.</p>
              <DigestSignup defaultRegionId={scopeId} src="roundup" />
            </section>
          </>
        ) : null}

        <footer className="methodology-foot">
          <a className="back" href="/roundup">
            <ArrowLeft />
            All roundups
          </a>
        </footer>
      </div>
    </main>
  );
}
