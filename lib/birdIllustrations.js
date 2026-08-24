import { settleWithConcurrency } from "./asyncPool.js";
import {
  generateBirdIllustration,
  generationConfigured,
  illustrationAlt,
  listGeneratedIllustrations
} from "./illustrationGeneration.js";

const BIRD_ILLUSTRATIONS = Object.freeze({
  baisan: {
    path: "/digest-illustrations/baisan-v1.jpg",
    alt: "Stylized field-guide illustration of a Baird's Sandpiper"
  },
  bbwduc: {
    path: "/digest-illustrations/bbwduc-v1.jpg",
    alt: "Stylized field-guide illustration of a Black-bellied Whistling-Duck"
  },
  brnboo: {
    path: "/digest-illustrations/brnboo-v1.jpg",
    alt: "Stylized field-guide illustration of a Brown Booby"
  },
  libher: {
    path: "/digest-illustrations/libher-v1.jpg",
    alt: "Stylized field-guide illustration of a Little Blue Heron"
  },
  sancra: {
    path: "/digest-illustrations/sancra-v1.jpg",
    alt: "Stylized field-guide illustration of a Sandhill Crane"
  },
  stisan: {
    path: "/digest-illustrations/stisan-v1.jpg",
    alt: "Stylized field-guide illustration of a Stilt Sandpiper"
  },
  wispet: {
    path: "/digest-illustrations/wispet-v1.jpg",
    alt: "Stylized field-guide illustration of a Wilson's Storm-Petrel"
  },
  woosto: {
    path: "/digest-illustrations/woosto-v1.jpg",
    alt: "Stylized field-guide illustration of a Wood Stork"
  }
});

// Resolution order per finding: curated V1 asset, then the Blob cache of
// previously generated plates, then (only when generateMissing is set, from
// the cron paths) a fresh one-time generation. A species that cannot be
// resolved stays text-only; nothing here ever throws into the send path.
export async function addBirdIllustrations(
  roundup,
  appUrl = "https://flockline.app",
  {
    generateMissing = false,
    generationBudget = 6,
    generationConcurrency = 3,
    listGenerated = listGeneratedIllustrations,
    generate = generateBirdIllustration
  } = {}
) {
  const findings = Array.isArray(roundup?.findings) ? roundup.findings : [];
  if (!findings.length) {
    return roundup;
  }

  let generated = new Map();
  try {
    generated = await listGenerated();
  } catch (error) {
    console.error(JSON.stringify({
      event: "illustration_cache_list_failed",
      message: error?.message
    }));
  }

  const resolveExisting = (finding) => {
    const curated = resolveBirdIllustration(finding, appUrl);
    if (curated) {
      return curated;
    }
    const code = String(finding?.speciesCode || "").trim().toLowerCase();
    const cachedUrl = generated.get(code);
    if (!cachedUrl) {
      return null;
    }
    return {
      url: cachedUrl,
      alt: illustrationAlt(finding.comName || finding.title || "bird"),
      kind: "species-illustration"
    };
  };

  if (generateMissing && generationConfigured()) {
    const missing = [];
    const seen = new Set();
    for (const finding of findings) {
      const code = String(finding?.speciesCode || "").trim().toLowerCase();
      if (code && finding.comName && !resolveExisting(finding) && !seen.has(code)) {
        seen.add(code);
        missing.push(finding);
      }
    }
    const toGenerate = missing.slice(0, Math.max(0, generationBudget));
    if (toGenerate.length) {
      const results = await settleWithConcurrency(toGenerate, generationConcurrency, async (finding) => {
        try {
          const made = await generate({
            speciesCode: finding.speciesCode,
            comName: finding.comName,
            sciName: finding.sciName
          });
          generated.set(made.speciesCode, made.url);
          console.log(JSON.stringify({
            event: "illustration_generated",
            speciesCode: made.speciesCode
          }));
        } catch (error) {
          console.error(JSON.stringify({
            event: "illustration_generation_failed",
            speciesCode: finding.speciesCode,
            message: error?.message
          }));
        }
      });
      void results;
    }
  }

  return {
    ...roundup,
    findings: findings.map((finding) => {
      const illustration = resolveExisting(finding);
      const { image: _unusedImage, ...findingWithoutImage } = finding;
      return illustration
        ? { ...findingWithoutImage, image: illustration }
        : findingWithoutImage;
    })
  };
}

export function resolveBirdIllustration(finding, appUrl = "https://flockline.app") {
  const speciesCode = String(finding?.speciesCode || "").trim().toLowerCase();
  const illustration = BIRD_ILLUSTRATIONS[speciesCode];
  if (!illustration) {
    return null;
  }

  return {
    url: new URL(illustration.path, normalizedAppUrl(appUrl)).toString(),
    alt: illustration.alt,
    kind: "species-illustration"
  };
}

function normalizedAppUrl(value) {
  const url = new URL(String(value || "https://flockline.app"));
  if (url.protocol !== "https:") {
    throw new Error("Digest illustrations require an HTTPS public app URL.");
  }
  return url;
}
