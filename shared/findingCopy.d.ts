type FindingFacts = {
  comName?: string | null;
  locName?: string | null;
  region?: string | null;
  regionName?: string | null;
  obsDt?: string | null;
  howMany?: number | string | null;
  obsValid?: boolean | null;
  obsReviewed?: boolean | null;
};

type FactualFinding<T extends FindingFacts> = Omit<T, "kind" | "title" | "detail" | "generatedBy"> & {
  kind: "notable";
  title: string;
  detail: string;
  generatedBy: "template";
};

export function factualFinding<T extends FindingFacts>(
  finding: T,
  options?: { count?: number | string | null },
): FactualFinding<T>;

export function factualEditorialPayload<T extends { findings?: FindingFacts[]; editorialPolicy?: string }>(
  payload: T,
  options?: { correctLegacy?: boolean },
): Omit<T, "findings" | "generator" | "summary"> & {
  generator: "template";
  editorialPolicy: string;
  editorialNote?: string;
  summary: string;
  findings: FactualFinding<NonNullable<T["findings"]>[number]>[];
};

export function reviewStatusLabel(finding?: Pick<FindingFacts, "obsValid" | "obsReviewed">): string;
