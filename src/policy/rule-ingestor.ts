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
    const description = rule.description?.trim() ?? '';
    // Combine title + description so embeddings and the LLM both see
    // the full intent of the rule, not just its short name.
    const text = description
      ? `${title}\n\nDescription: ${description}`
      : title;
    return {
      id: `rule:${index}`,
      source: 'rule',
      title,
      text,
      metadata: {
        priority: String(rule.priority ?? index),
        description, // stored separately so classifier can surface it
      },
    };
  });
}
