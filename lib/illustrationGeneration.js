import { list, put } from "@vercel/blob";
import { archiveConfigured } from "./roundupArchive.js";

// On-demand species illustrations. The eight curated V1 assets in
// public/digest-illustrations/ stay canonical for their species; every other
// digest species gets a one-time generated plate in the same art direction,
// cached forever in the Blob store under illustrations/{code}-v1.jpg. The
// editorial rule is unchanged: visibly stylized, never photorealistic, never
// presented as the reported individual, and no photographic fallback.
const SHARED_DIRECTION =
  "Create a clearly stylized and species-accurate field-guide illustration on warm cream paper. "
  + "Use visible graphite linework with watercolor and gouache, like a refined vintage natural-history plate. "
  + "Use a generic, species-appropriate habitat with no identifiable location. "
  + "Show one full bird in a natural pose in a 3:2 landscape composition. "
  + "Keep the result visibly illustrated and never photorealistic. "
  + "This is a generic representative of the species, not a depiction of a reported individual. "
  + "Include no text, labels, borders, logos, watermark, people, bird bands, GPS pins, app interface, nest, or eggs.";

const GATEWAY_IMAGES_URL = "https://ai-gateway.vercel.sh/v1/images/generations";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const GENERATED_PREFIX = "illustrations/";
const IMAGE_TIMEOUT_MS = 150_000;

// Auth: an explicit AI Gateway key wins; otherwise the Vercel OIDC token that
// the platform injects into deployed functions (and `vercel env pull` provides
// locally) authenticates against the same gateway.
export function gatewayAuthToken(environment = process.env) {
  return String(environment.AI_GATEWAY_API_KEY || environment.VERCEL_OIDC_TOKEN || "").trim();
}

export function generationConfigured(environment = process.env) {
  return archiveConfigured(environment) && Boolean(gatewayAuthToken(environment));
}

export function generatedIllustrationPath(speciesCode) {
  return `${GENERATED_PREFIX}${speciesCode}-v1.jpg`;
}

export function illustrationAlt(comName) {
  return `Stylized field-guide illustration of a ${comName}`;
}

// Map of speciesCode -> public blob URL for every already-generated plate.
export async function listGeneratedIllustrations({ blobList = list } = {}) {
  const generated = new Map();
  if (!archiveConfigured()) {
    return generated;
  }
  let cursor;
  do {
    const page = await blobList({ prefix: GENERATED_PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs || []) {
      const match = String(blob.pathname || "").match(/^illustrations\/([a-z0-9]+)-v1\.jpg$/);
      if (match) {
        generated.set(match[1], blob.url);
      }
    }
    cursor = page.cursor && page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return generated;
}

// One illustrator-facing sentence of diagnostic field marks. Written by the
// model when a key is available so obscure species stay accurate; the plain
// fallback still names the species and demands accuracy.
export async function describeSpeciesForArt(
  { comName, sciName },
  { fetcher = fetch, environment = process.env } = {}
) {
  const fallback = `${comName}${sciName ? ` (${sciName})` : ""}, rendered with accurate diagnostic field marks, proportions, and seasonally typical adult plumage, in a generic natural habitat for the species.`;
  const apiKey = String(environment.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) {
    return fallback;
  }

  try {
    const response = await fetcher(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: String(environment.INSIGHTS_MODEL || "claude-haiku-4-5"),
        max_tokens: 300,
        messages: [{
          role: "user",
          content: `In one sentence addressed to an illustrator, describe the bird species ${comName}${sciName ? ` (${sciName})` : ""}: its diagnostic field marks, proportions, seasonally typical adult plumage, and a natural pose in a generic habitat appropriate to the species. Plain prose, no lists, no preamble.`
        }]
      })
    });
    if (!response.ok) {
      return fallback;
    }
    const payload = await response.json();
    const text = String(payload?.content?.[0]?.text || "").trim();
    return text.length > 20 ? `${comName}${sciName ? ` (${sciName})` : ""}: ${text}` : fallback;
  } catch {
    return fallback;
  }
}

export function buildIllustrationPrompt(description) {
  return `${SHARED_DIRECTION} The species: ${description}`;
}

export async function generateBirdIllustration(
  { speciesCode, comName, sciName },
  { fetcher = fetch, blobPut = put, environment = process.env, describe = describeSpeciesForArt } = {}
) {
  if (!generationConfigured(environment)) {
    throw new Error("Illustration generation is not configured (Blob token or gateway auth missing).");
  }
  const code = String(speciesCode || "").trim().toLowerCase();
  if (!/^[a-z0-9]+$/.test(code) || !comName) {
    throw new Error("A species code and common name are required.");
  }

  const description = await describe({ comName, sciName }, { fetcher, environment });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetcher(GATEWAY_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayAuthToken(environment)}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: String(environment.ILLUSTRATION_MODEL || "openai/gpt-image-1"),
        prompt: buildIllustrationPrompt(description),
        size: "1536x1024",
        quality: "medium",
        output_format: "jpeg",
        output_compression: 85
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Image generation failed (${response.status}): ${body.slice(0, 160)}`);
  }

  const payload = await response.json();
  const encoded = payload?.data?.[0]?.b64_json;
  if (!encoded) {
    throw new Error("The image model returned no image data.");
  }

  const saved = await blobPut(generatedIllustrationPath(code), Buffer.from(encoded, "base64"), {
    access: "public",
    contentType: "image/jpeg",
    addRandomSuffix: false,
    allowOverwrite: true
  });
  return { speciesCode: code, url: saved.url, alt: illustrationAlt(comName) };
}
