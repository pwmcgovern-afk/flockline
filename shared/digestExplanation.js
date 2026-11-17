// Only the structured, versioned explanation is allowed through publication.
export function digestExplanation(finding = {}) {
  const value = finding.significance;
  if (
    value?.policyVersion !== "review-evidence-v1" ||
    typeof value.explanation !== "string" ||
    !value.explanation.trim()
  )
    return null;
  try {
    if (new URL(value.sourceUrl).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return value;
}
