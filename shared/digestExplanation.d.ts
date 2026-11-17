export type DigestSignificance = {
  policyVersion: string;
  registryVersion: string;
  ruleId: string;
  kind: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceRetrieved: string;
  area: string;
  explanation: string;
};
export function digestExplanation(finding?: {
  significance?: DigestSignificance;
}): DigestSignificance | null;
