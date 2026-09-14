import { ArrowRight, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import type { ArchiveRoundup } from "./RoundupArchive";
import { requestJson } from "./request";

// Read a saved issue, never the generation endpoint. A preview should stay
// inexpensive and show exactly what subscribers received, with its real date.
export default function LatestIssuePreview({ regionId, compact = false }: { regionId: string; compact?: boolean }) {
  const [issue, setIssue] = useState<ArchiveRoundup | null>(null);
  const [status, setStatus] = useState("Loading a published issue…");

  useEffect(() => {
    const controller = new AbortController();
    setIssue(null);
    setStatus("Loading a published issue…");
    requestJson<ArchiveRoundup>(`/api/roundup-archive?scope=${encodeURIComponent(regionId)}`, { signal: controller.signal })
      .then(({ response, body }) => {
        if (controller.signal.aborted) return;
        if (!response.ok || body.scopeId !== regionId || !body.findings?.length || !/^\d{4}-\d{2}-\d{2}T/.test(body.generatedAt)) {
          setStatus("Browse published issues to see what lands in your inbox.");
          return;
        }
        setIssue(body);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("The preview is unavailable right now. You can still browse past issues.");
      });
    return () => controller.abort();
  }, [regionId]);

  // Hide the previous edition immediately when the selector changes, including
  // the render before its new request starts.
  const current = issue?.scopeId === regionId ? issue : null;
  const finding = current?.findings.find((bird) => bird.image?.kind === "species-illustration" && bird.image.url) ?? current?.findings[0];
  const image = finding?.image?.kind === "species-illustration" ? finding.image : null;
  const date = current?.generatedAt.slice(0, 10);
  const issueUrl = current ? `/roundup/${regionId}/${date}` : "/roundup";
  const otherBirds = current?.findings.filter((bird) => bird !== finding && bird.comName).slice(0, 2);
  const Heading = compact ? "h4" : "h2";

  return (
    <article className={`issue-preview ${compact ? "issue-preview-compact" : ""}`} aria-label="Published digest preview">
      <div className="issue-preview-label"><BookOpen size={14} aria-hidden="true" /> From the latest published issue</div>
      {current && finding ? (
        <>
          <div className="issue-preview-body">
            {image?.url ? (
              <figure>
                <img src={image.url} alt={image.alt || `Illustration of ${finding.comName || finding.title}`} loading="lazy" />
                <figcaption>Species illustration, not the reported individual.</figcaption>
              </figure>
            ) : null}
            <div className="issue-preview-copy">
              <p className="issue-preview-date">{current.scopeLabel} · <time dateTime={date}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}</time></p>
              <Heading className="issue-preview-title">{finding.title}</Heading>
              {finding.locName ? <p className="issue-preview-location">Reported at {finding.locName}.</p> : null}
              {!compact && otherBirds?.length ? <p className="issue-preview-more">Also inside: {otherBirds.map((bird) => bird.comName).join(", ")}.</p> : null}
            </div>
          </div>
          <a className="issue-preview-link" href={issueUrl}>Read the {current.findings.length}-bird issue <ArrowRight size={15} aria-hidden="true" /></a>
        </>
      ) : (
        <>
          <p role="status">{status}</p>
          <a className="issue-preview-link" href={issueUrl}>Browse past issues <ArrowRight size={15} aria-hidden="true" /></a>
        </>
      )}
    </article>
  );
}
