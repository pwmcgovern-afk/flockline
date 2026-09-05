import { setTimeout as delay } from "node:timers/promises";

export function createDigestProvider(apiKey, { fetcher = fetch, sleep = delay } = {}) {
  const request = async (path, { method = "GET", body } = {}) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetcher(`https://api.resend.com${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000)
      });
      const data = await response.json();
      if (response.status === 429 && attempt < 2) {
        await sleep(Math.min(5000, Math.max(1000, Number(response.headers.get("retry-after")) * 1000 || 1000)));
        continue;
      }
      if (!response.ok) {
        const error = new Error(data.message || `Resend request failed (${response.status}).`);
        error.statusCode = response.status;
        throw error;
      }
      return data;
    }
  };
  const pages = async function* (path) {
    let after;
    do {
      const query = new URLSearchParams({ limit: "100", ...(after ? { after } : {}) });
      const page = await request(`${path}?${query}`);
      if (!Array.isArray(page.data)) throw new Error("Resend returned an invalid list.");
      yield page.data;
      const next = page.has_more ? page.data.at(-1)?.id : undefined;
      if (page.has_more && (!next || next === after)) throw new Error("Resend pagination did not advance.");
      after = next;
    } while (after);
  };
  return {
    async hasRecipients(configuration, region) {
      const topic = await request(`/topics/${region.topicId}`);
      for await (const contacts of pages(`/segments/${configuration.segmentId}/contacts`)) {
        for (const contact of contacts) {
          if (contact.unsubscribed) continue;
          let subscription;
          for await (const topics of pages(`/contacts/${contact.id}/topics`)) {
            subscription = topics.find((item) => item.id === region.topicId)?.subscription;
            if (subscription) break;
          }
          if ((subscription || topic.default_subscription) === "opt_in") return true;
        }
      }
      return false;
    },
    async verifySender(from) {
      const address = from.match(/<([^>]+)>/)?.[1] || from;
      const domainName = address.split("@")[1]?.toLowerCase();
      for await (const domains of pages("/domains")) {
        if (domains.some((domain) => domain.name.toLowerCase() === domainName && domain.status === "verified")) return;
      }
      throw new Error("The digest sender domain is not verified in Resend.");
    },
    async findBroadcast(name) {
      for await (const broadcasts of pages("/broadcasts")) {
        const matches = broadcasts.filter((item) => item.name === name);
        if (matches.length > 1) throw new Error("Multiple matching broadcasts require review.");
        if (matches[0]) return request(`/broadcasts/${matches[0].id}`);
      }
      return null;
    },
    getBroadcast: (id) => request(`/broadcasts/${id}`),
    createDraft: (broadcast) => request("/broadcasts", {
      method: "POST",
      body: {
        name: broadcast.name, segment_id: broadcast.segmentId, topic_id: broadcast.topicId,
        from: broadcast.from, reply_to: broadcast.replyTo, subject: broadcast.subject,
        preview_text: broadcast.previewText, html: broadcast.html, text: broadcast.text,
        send: false
      }
    }),
    sendBroadcast: (id) => request(`/broadcasts/${id}/send`, { method: "POST", body: {} })
  };
}
