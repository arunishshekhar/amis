import type { PolicyObject } from '../types/policy-object';

export type SubredditRule = {
  shortName?: string;
  description?: string;
  priority?: number;
};

export async function ingestRules(
  subredditName: string,
  getRules: (subredditName: string) => Promise<SubredditRule[]>
): Promise<PolicyObject[]> {
  const rules = await getRules(subredditName);
  return rules.map((rule, index): PolicyObject => {
    const title = rule.shortName ?? `Rule ${index + 1}`;
    return {
      id: `rule:${index}`,
      source: 'rule',
      title,
      text: `${title}: ${rule.description ?? ''}`.trim(),
      metadata: { priority: String(rule.priority ?? index) },
    };
  });
}
