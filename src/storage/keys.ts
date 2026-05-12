export const KEYS = {
  modItem: (id: string) => `mod_item:${id}`,
  embedding: (id: string) => `embedding:${id}`,
  modItemIndex: 'mod_item_index',
  policy: (id: string) => `policy:${id}`,
  policyIndex: 'policy_index',
  policyEmbedding: (id: string) => `policy_embedding:${id}`,
  recommendation: (id: string) => `recommendation:${id}`,
  recommendationIndex: 'recommendation_index',
  modDecision: (id: string) => `moddecision:${id}`,
  modDecisionIndex: 'moddecision_index',
  insight: (id: string) => `insight:${id}`,
  insightIndex: 'insight_index',
};
