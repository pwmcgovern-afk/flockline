export function sightingPath(finding: {
  subId?: string | null;
  speciesCode?: string | null;
}): string | null;
export function parseSightingPath(
  pathname: string,
): { subId: string; speciesCode: string } | null;
