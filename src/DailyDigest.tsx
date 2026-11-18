import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Share2 } from "lucide-react";
import type { Insight, InsightsResponse } from "./types";
import { DAILY_WINDOWS, dailyDate, dailyDigestPath, dailyScope, parseDailyDigestPath, scopeFromId } from "../shared/dailyDigest.js";
import { US_REGION_PRESETS } from "../shared/usGeography.js";
import { reviewStatusLabel } from "../shared/findingCopy.js";
import { sightingPath } from "../shared/sightingPath.js";
import { requestJson } from "./request";
import HistoricalContext from "./HistoricalContext";
import NotFound from "./NotFound";

export type SavedDailyDigest = Omit<InsightsResponse, "findings"> & {
  version: "daily-v1"; scopeId: string; date: string; publishedAt: string;
  findings: (Insight & { image?: { url: string; alt: string; kind: string } })[];
};
export type DailyIndex = { issues: { scopeId: string; date: string; back: number; path: string }[] };
export type DailyInitial = { dailyDigest?: SavedDailyDigest; dailyIndex?: DailyIndex; dailyPending?: boolean };

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
}
export function DailyDigestActions({ regions, back, snapshot }: { regions: string[]; back: number; snapshot?: SavedDailyDigest }) {
  const scope = dailyScope(regions);
  const date = snapshot?.date || dailyDate();
  const path = scope && dailyDigestPath(scope.id, date, back);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [fallback, setFallback] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  if (!scope || !path) return null;

  async function share() {
    if (!scope || !path) return;
    setBusy(true); setStatus(""); setFallback("");
    try {
      if (!snapshot) {
        const { response, body } = await requestJson<SavedDailyDigest & { error?: string }>("/api/daily-digest", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: scope.id, date, back }),
        });
        if (!response.ok) throw new Error(body.error || "The digest could not be saved. Please try again.");
      }
      if (!active.current) return;
      const url = new URL(path, window.location.origin).href;
      // Preparing a new edition can consume the native share sheet's user activation.
      if (snapshot && navigator.share) {
        try { await navigator.share({ title: scope.label + " bird digest", url }); setStatus("Digest shared"); return; }
        catch (error) { if (error instanceof Error && error.name === "AbortError") return; }
      }
      try { await navigator.clipboard.writeText(url); setStatus("Digest link copied"); }
      catch { setFallback(url); setStatus("Your digest is ready. Copy its address below."); }
    } catch (error) { setStatus(error instanceof Error ? error.message : "The digest could not be shared."); }
    finally { setBusy(false); }
  }
  return <div className="daily-actions">
    <div className="daily-action-buttons">
      <a className="pill" href={path}>Open digest <ExternalLink size={15} /></a>
      <button className="pill primary" type="button" onClick={() => void share()} disabled={busy}><Share2 size={15} />{busy ? "Saving digest…" : "Share digest"}</button>
    </div>
    <span role="status" className="daily-action-status">{status}</span>
    {fallback && <input className="daily-share-address" aria-label="Digest address" readOnly value={fallback} onFocus={(event) => event.currentTarget.select()} />}
  </div>;
}

export default function DailyDigest({ pathname = window.location.pathname, initial = {} }: { pathname?: string; initial?: DailyInitial }) {
  const parsed = parseDailyDigestPath(pathname);
  if (!parsed.valid) return <NotFound />;
  return parsed.scopeId
    ? <DailyIssue scopeId={parsed.scopeId} date={parsed.date || dailyDate()} back={parsed.back || 1} initial={initial.dailyDigest} />
    : <DailyIndexPage initial={initial.dailyIndex} />;
}

function DailyIndexPage({ initial }: { initial?: DailyIndex }) {
  const [index, setIndex] = useState<DailyIndex | null>(initial || null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    requestJson<DailyIndex>("/api/daily-digest?list=1", { signal: controller.signal })
      .then(({ response, body }) => { if (!response.ok) throw new Error(); if (!controller.signal.aborted) setIndex(body); })
      .catch(() => { if (!controller.signal.aborted) setError("The saved digests could not be loaded. Please try again."); });
    return () => controller.abort();
  }, [initial]);
  return <main className="methodology daily-page"><div className="methodology-inner">
    <a className="back" href="/"><ArrowLeft />Back to the map</a>
    <header className="methodology-head"><p>Daily digests</p><h1>Bird reports you can share</h1></header>
    <p className="newsletter-lede">A dated edition for each region, saved with its original reports. Open today's digest or browse a previous day.</p>
    <nav className="daily-region-links" aria-label="Today's daily digests">{US_REGION_PRESETS.map((region) => <a className="pill" key={region.id} href={dailyDigestPath(region.id, dailyDate())!}>{region.name}</a>)}</nav>
    {error && <p role="alert">{error}</p>}
    {!index && !error && <p role="status">Loading saved digests…</p>}
    {index && <section><h2>Saved editions</h2>{index.issues.length ? <ul className="archive-issue-list">{index.issues.slice(0, 150).map((issue) => <li key={issue.path}><a href={issue.path}>{scopeFromId(issue.scopeId)?.label} · {dateLabel(issue.date)}{issue.back !== 1 ? " · " + issue.back + "-day window" : ""}</a></li>)}</ul> : <p>The first editions will appear here as they are saved.</p>}</section>}
    <footer className="methodology-foot"><a href="/roundup">Weekly roundup archive</a></footer>
  </div></main>;
}

function DailyIssue({ scopeId, date, back, initial }: { scopeId: string; date: string; back: number; initial?: SavedDailyDigest }) {
  const [digest, setDigest] = useState<SavedDailyDigest | null>(initial || null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (initial && !attempt) return;
    const controller = new AbortController();
    setError(""); setMissing(false);
    const current = date === dailyDate();
    const query = new URLSearchParams({ scope: scopeId, date, back: String(back) });
    requestJson<SavedDailyDigest & { error?: string }>(current ? "/api/daily-digest" : "/api/daily-digest?" + query, {
      signal: controller.signal,
      ...(current ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: scopeId, date, back }) } : {}),
    }).then(({ response, body }) => {
      if (controller.signal.aborted) return;
      if (response.status === 404) { setMissing(true); return; }
      if (!response.ok || body.version !== "daily-v1") throw new Error(body.error || "This digest could not be loaded. Please try again.");
      setDigest(body);
    }).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "This digest could not be loaded. Please try again."); });
    return () => controller.abort();
  }, [scopeId, date, back, initial, attempt]);
  const scope = scopeFromId(scopeId)!;
  return <main className="methodology daily-page"><div className="methodology-inner">
    <a className="back" href="/digest"><ArrowLeft />All daily digests</a>
    <header className="methodology-head"><p>{dateLabel(date)} · past {back} {back === 1 ? "day" : "days"}</p><h1>{scope.label} bird digest</h1></header>
    <p className="newsletter-lede">Selected reports from eBird's notable feed, chosen by recency and location. This selection is not a ranking of rarity.</p>
    {digest && <>
      <p className="archive-meta">Saved {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(digest.generatedAt))}. This edition keeps its original reports.</p>
      <DailyDigestActions regions={digest.regions} back={back} snapshot={digest} />
      {digest.coverage.limitedRegions?.length ? <p className="daily-coverage">Partial source coverage. Some state feeds reached eBird's result limit, so this is a saved sample of available reports.</p> : null}
      {!digest.findings.length && <p>No reports were included in this saved selection.</p>}
      {digest.findings.map((finding, index) => <article className="archive-finding" key={(finding.speciesCode || finding.title) + index}>
        {finding.image?.kind === "species-illustration" && <figure className="archive-illustration"><img src={finding.image.url} alt={finding.image.alt} loading="lazy" /><figcaption>Flockline species illustration · Not the reported individual.</figcaption></figure>}
        <span className="archive-kind">eBird notable report</span>
        <h2>{sightingPath(finding) ? <a href={sightingPath(finding)!}>{finding.title}</a> : finding.title}</h2>
        <p>{finding.detail}</p>
        <p className="archive-meta">{reviewStatusLabel(finding)}</p>
        <HistoricalContext finding={finding} />
        <p className="archive-links">
          {sightingPath(finding) && <a href={sightingPath(finding)!}>Learn more →</a>}
          {finding.speciesCode && <a href={`/?bird=${encodeURIComponent(finding.speciesCode)}&states=${encodeURIComponent(finding.regionCode || digest.regions.join(","))}&days=${back}&provisional=1&hotspots=0`}>View on map</a>}
          {finding.subId && <a href={"https://ebird.org/checklist/" + encodeURIComponent(finding.subId)} target="_blank" rel="noreferrer">eBird checklist <ExternalLink size={12} /></a>}
        </p>
      </article>)}
      <nav className="daily-region-links" aria-label="Other daily digest windows">{DAILY_WINDOWS.map((days) => <a className="pill" aria-current={back === days ? "page" : undefined} key={days} href={dailyDigestPath(scopeId, date, days)!}>{days}-day window</a>)}</nav>
    </>}
    {!digest && !error && !missing && <p role="status">Preparing this day's digest…</p>}
    {error && <p role="alert">{error} <button className="pill" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>}
    {missing && <p>No digest was saved for this day and window. <a href="/digest">Browse saved editions</a>.</p>}
    <footer className="methodology-foot"><a href="/">Explore the live map</a><a href="/newsletter">Get the weekly email</a><a href="/methodology">How reports are selected</a></footer>
  </div></main>;
}
