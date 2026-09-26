import { ArrowLeft, ArrowUpRight, Map, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChecklistDetailsResponse, Insight } from "./types";
import { requestJson } from "./request";
import { parseSightingPath } from "../shared/sightingPath.js";
import NotFound from "./NotFound";
import "./sighting.css";

export type SightingPhoto = {
  assetId: string;
  speciesCode: string;
  subId?: string;
  credit: string;
  locName?: string;
  observedAt?: string;
  match: "checklist" | "species";
};
export type SightingDetails = {
  finding: Insight & {
    sciName?: string;
    scopeId?: string;
    image?: { url: string; alt: string; kind: string };
  };
  checklist: ChecklistDetailsResponse;
  observationExcerpt: string;
  checklistExcerpt: string;
  media: { status: "ready" | "none" | "unavailable"; photos: SightingPhoto[] };
};

function formatDate(value?: string | null) {
  if (!value) return "Not supplied";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  const day = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  // eBird timestamps are local to the observation. Do not reinterpret them in
  // the visitor's timezone, which can move a report onto a different date.
  const time = value.match(/\b(\d{2}):(\d{2})/)?.slice(1);
  if (!time) return day;
  const hour = Number(time[0]);
  return `${day} · ${hour % 12 || 12}:${time[1]} ${hour >= 12 ? "PM" : "AM"} local time`;
}

export default function SightingPage({
  pathname = window.location.pathname,
  initial,
}: {
  pathname?: string;
  initial?: SightingDetails;
}) {
  const address = parseSightingPath(pathname);
  const [data, setData] = useState(initial);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
    initial ? "ready" : "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const subId = address?.subId;
  const speciesCode = address?.speciesCode;
  useEffect(() => {
    if (!subId || !speciesCode || (initial && attempt === 0)) return;
    const controller = new AbortController();
    setState("loading");
    requestJson<SightingDetails>(
      `/api/sighting?${new URLSearchParams({ subId, species: speciesCode })}`,
      { signal: controller.signal },
    )
      .then(({ response, body }) => {
        if (controller.signal.aborted) return;
        if (response.status === 404) return setState("missing");
        if (!response.ok || !body.checklist?.observation || !body.finding)
          throw new Error();
        setData(body);
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, [subId, speciesCode, initial, attempt]);

  if (!address || state === "missing") return <NotFound />;
  const mapUrl = `/?${new URLSearchParams({ bird: speciesCode!, days: "30", region: data?.finding.scopeId || "nationwide", view: "insights" })}`;
  return (
    <main className="methodology sighting-page">
      <div className="methodology-inner">
        <nav className="sighting-nav" aria-label="Sighting navigation">
          <a className="back" href={mapUrl}>
            <ArrowLeft /> Back to sightings
          </a>
          <a href="/roundup">Weekly roundups</a>
        </nav>
        {state === "loading" ? (
          <p role="status">Opening the field notes…</p>
        ) : null}
        {state === "error" ? (
          <div role="alert">
            <h1>This report is temporarily unavailable</h1>
            <p>Please try again in a moment.</p>
            <button
              className="pill"
              onClick={() => setAttempt((current) => current + 1)}
            >
              Try again
            </button>
          </div>
        ) : null}
        {state === "ready" && data ? (
          <SightingArticle data={data} mapUrl={mapUrl} />
        ) : null}
      </div>
    </main>
  );
}

function SightingArticle({
  data,
  mapUrl,
}: {
  data: SightingDetails;
  mapUrl: string;
}) {
  const { finding, checklist, media } = data;
  const checklistUrl = `https://ebird.org/checklist/${checklist.subId}`;
  const count = checklist.observation?.count;
  const photo = media.photos[0];
  const [selected, setSelected] = useState(0);
  const activePhoto = media.photos[selected] || photo;
  const image =
    finding.image?.kind === "species-illustration" ? finding.image : null;
  return (
    <article>
      <header className="sighting-head">
        <span className="archive-kind">The field notes · Featured eBird checklist</span>
        <h1>{finding.comName || "Bird sighting"}</h1>
        {finding.sciName ? (
          <p className="sighting-scientific">{finding.sciName}</p>
        ) : null}
        {finding.locName ? (
          <p className="sighting-location">
            <MapPin size={17} /> {finding.locName}
            {finding.region ? `, ${finding.region}` : ""}
          </p>
        ) : null}
        <p className="sighting-byline">
          {formatDate(checklist.observedAt)}
          {checklist.observerName
            ? ` · Reported by ${checklist.observerName}`
            : ""}
        </p>
      </header>

      <aside className="sighting-scope" aria-label="How to read these counts">
        <strong>This page features one checklist.</strong>
        <p>
          {count && count !== "X"
            ? `${count} ${count === "1" ? "bird was" : "birds were"} recorded for this species on this visit. `
            : "This species was present on this visit, but the birds were not counted. "}
          {finding.detail
            ? "The regional overview below counts reports from multiple visits. Those reports can include repeat sightings of the same birds."
            : "The count and field notes below apply to this visit only."}
        </p>
      </aside>

      {activePhoto ? (
        <section className="sighting-photos" aria-label="Bird photographs">
          <div className="sighting-photo-label">
            {activePhoto.match === "checklist"
              ? "Photographed on this checklist"
              : "Species photo · Different report"}
          </div>
          <iframe
            key={activePhoto.assetId}
            title={`${finding.comName} photograph by ${activePhoto.credit}`}
            src={`https://macaulaylibrary.org/asset/${activePhoto.assetId}/embed`}
            allowFullScreen
            loading="eager"
          />
          <p className="sighting-photo-credit">
            © {activePhoto.credit} · Cornell Lab of Ornithology | Macaulay
            Library
          </p>
          {activePhoto.match === "species" ? (
            <p className="sighting-photo-context">
              Reference photograph from a different report
              {activePhoto.locName ? ` at ${activePhoto.locName}` : ""}
              {activePhoto.observedAt
                ? ` on ${formatDate(activePhoto.observedAt)}`
                : ""}
              . It does not document this sighting.
            </p>
          ) : null}
          {media.photos.length > 1 ? (
            <div
              className="sighting-photo-picker"
              role="group"
              aria-label="Choose a photo"
            >
              {media.photos.map((item, index) => (
                <button
                  key={item.assetId}
                  className="pill"
                  aria-pressed={index === selected}
                  onClick={() => setSelected(index)}
                >
                  Photo {index + 1}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : image ? (
        <figure className="archive-illustration sighting-illustration">
          <img src={image.url} alt={image.alt} />
          <figcaption>
            Flockline species illustration. Not the reported individual.
          </figcaption>
        </figure>
      ) : null}

      <section className="sighting-notes">
        <span className="archive-kind">Notes from this checklist</span>
        {data.observationExcerpt ? (
          <blockquote>
            <p>“{data.observationExcerpt}”</p>
            <footer>
              {checklist.observerName || "The observer"},{" "}
              <a
                href={`${checklistUrl}#${finding.speciesCode}`}
                target="_blank"
                rel="noreferrer"
              >
                eBird field notes <ArrowUpRight size={13} />
              </a>
            </footer>
          </blockquote>
        ) : (
          <p>The observer did not add written notes for this species.</p>
        )}
        {data.checklistExcerpt ? (
          <p className="sighting-checklist-note">
            Checklist excerpt: “{data.checklistExcerpt}”
          </p>
        ) : null}
      </section>

      <section>
        <h2>On this checklist</h2>
        <dl className="sighting-facts">
          <div>
            <dt>Birds of this species</dt>
            <dd>
              {count === "X" ? "Present, not counted" : count || "Not counted"}
            </dd>
          </div>
          <div>
            <dt>Survey type</dt>
            <dd>{checklist.protocolLabel || "Not supplied"}</dd>
          </div>
          <div>
            <dt>Time in the field</dt>
            <dd>
              {checklist.durationMinutes != null
                ? `${checklist.durationMinutes} minutes`
                : "Not supplied"}
            </dd>
          </div>
          <div>
            <dt>Distance covered</dt>
            <dd>
              {checklist.distanceKm != null
                ? `${checklist.distanceKm.toLocaleString()} km`
                : "Not supplied"}
            </dd>
          </div>
          <div>
            <dt>Observers</dt>
            <dd>{checklist.numObservers ?? "Not supplied"}</dd>
          </div>
          <div>
            <dt>Species on the checklist</dt>
            <dd>{checklist.numSpecies ?? "Not supplied"}</dd>
          </div>
        </dl>
      </section>

      {finding.detail ? (
        <section>
          <h2>Regional overview · Multiple reports</h2>
          <p>{finding.detail}</p>
          <p className="sighting-context">
            These are reports, not a count of distinct birds. We feature one
            supporting checklist above; the eBird button below opens that
            checklist, not the full set of regional reports.
          </p>
        </section>
      ) : null}
      {!media.photos.length && checklist.observation?.media.photos ? (
        <p className="sighting-small">
          This checklist has {checklist.observation.media.photos} photo
          {checklist.observation.media.photos === 1 ? "" : "s"}. Cornell’s photo
          preview is temporarily unavailable here.
        </p>
      ) : null}
      {media.status === "none" ? (
        <p className="sighting-small">
          No photos are attached to this species on the linked checklist.
        </p>
      ) : null}
      <div className="sighting-actions">
        <a className="sighting-action sighting-action-primary" href={mapUrl}>
          <Map size={17} /> Explore on the map
        </a>
        <a className="sighting-action" href={checklistUrl} target="_blank" rel="noreferrer">
          Open featured checklist <ArrowUpRight size={17} />
        </a>
      </div>
      <footer className="methodology-foot">
        <p className="sighting-small">
          Source: public eBird checklist {checklist.subId}. Notes are short
          excerpts credited to the observer. Sightings describe a reported
          moment and do not guarantee the bird is still present.
        </p>
        <a href="/methodology">How to read Flockline sightings</a>
      </footer>
    </article>
  );
}
