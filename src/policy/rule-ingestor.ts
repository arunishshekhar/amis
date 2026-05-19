import type { PolicyObject } from '../types/policy-object';

export type SubredditRule = {
  shortName?: string;
  description?: string;
  violationReason?: string;
  priority?: number;
};

export async function ingestRules(
  subredditName: string,
  getRules: (subredditName: string) => Promise<SubredditRule[]>
): Promise<PolicyObject[]> {
  const rules = await getRules(subredditName);
  if (!Array.isArray(rules)) return [];
  return rules.map((rule, index): PolicyObject => {
    const title = rule.shortName ?? `Rule ${index + 1}`;
    const description = rule.description?.trim() ?? '';
    const violationReason = rule.violationReason?.trim() ?? '';
    // Combine title + description so embeddings and the LLM both see
    // the full intent of the rule, not just its short name.
    const sections = [
      title,
      description ? `Description: ${description}` : '',
      violationReason ? `Removal reason: ${violationReason}` : '',
    ].filter(Boolean);
    const text = sections.join('\n\n');
    return {
      id: `rule:${index}`,
      source: 'rule',
      title,
      text,
      metadata: {
        priority: String(rule.priority ?? index),
        description, // stored separately so classifier can surface it
        violationReason,
      },
    };
  });
}
