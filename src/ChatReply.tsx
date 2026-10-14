import type { ReactNode } from "react";
import type { ChatChecklistSource } from "./types";

function inlineSources(text: string, sourceIds: Set<string>): ReactNode[] {
  // Consume whole URLs before looking for bare IDs, so an untrusted URL cannot
  // become a partially linked string. Every href is constructed from evidence.
  const tokens = /\[([^\]\n]+)\]\(([^\s)]+)\)|https?:\/\/[^\s<>]+|\bS\d{6,15}\b/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(tokens)) {
    const index = match.index!;
    parts.push(text.slice(cursor, index));
    const token = match[0];
    const candidate = match[2] || token.replace(/[.,;:!?)]*$/, "");
    const id = /^S\d{6,15}$/.test(candidate) ? candidate
      : candidate.match(/^https:\/\/ebird\.org\/checklist\/(S\d{6,15})$/)?.[1];
    if (id && sourceIds.has(id)) {
      parts.push(<a key={index} href={`https://ebird.org/checklist/${id}`} target="_blank" rel="noopener noreferrer">{match[1] || `eBird checklist ${id}`}</a>);
      if (!match[2]) parts.push(token.slice(candidate.length));
    } else parts.push(token);
    cursor = index + token.length;
  }
  parts.push(text.slice(cursor));
  return parts;
}

export default function ChatReply({ text, sources = [] }: { text: string; sources?: ChatChecklistSource[] }) {
  const validSources = sources.filter((source) => /^S\d{6,15}$/.test(source.subId));
  const sourceIds = new Set(validSources.map((source) => source.subId));
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(<ul key={`ul-${blocks.length}`}>{bullets.map((line, index) => <li key={index}>{inlineSources(line, sourceIds)}</li>)}</ul>);
    bullets = [];
  };
  for (const line of text.split(/\n+/).map((item) => item.trim()).filter(Boolean)) {
    const bullet = line.match(/^[-•*]\s+(.*)/);
    if (bullet) bullets.push(bullet[1]);
    else {
      flush();
      blocks.push(<p key={`p-${blocks.length}`}>{inlineSources(line, sourceIds)}</p>);
    }
  }
  flush();
  return <>
    {blocks}
    {validSources.length ? <details className="chat-sources">
      <summary>Source reports ({validSources.length})</summary>
      <ul>{validSources.map((source) => <li key={`${source.subId}:${source.speciesCode}`}>
        <a href={`https://ebird.org/checklist/${source.subId}`} target="_blank" rel="noopener noreferrer">{source.comName} · {source.locName}</a>
        <span>{[source.obsDt, source.reviewStatus].filter(Boolean).join(" · ")}</span>
      </li>)}</ul>
    </details> : null}
  </>;
}
