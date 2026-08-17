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

export function addBirdIllustrations(roundup, appUrl = "https://flockline.app") {
  const findings = Array.isArray(roundup?.findings) ? roundup.findings : [];
  if (!findings.length) {
    return roundup;
  }

  return {
    ...roundup,
    findings: findings.map((finding) => {
      const illustration = resolveBirdIllustration(finding, appUrl);
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
