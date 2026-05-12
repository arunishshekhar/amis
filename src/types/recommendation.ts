export type SuggestedAction = 'remove' | 'approve' | 'escalate' | 'monitor';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface Recommendation {
  itemId: string;
  suggestedAction: SuggestedAction;
  confidenceScore: number;        // 0–100, rounded integer
  riskLevel: RiskLevel;
  matchedPolicyId: string | null;
  matchedPolicyTitle: string | null;
  similarity: number;             // raw cosine score of best policy match
  rationale: string;              // deterministic template string
  generatedAt: number;            // Unix ms
  /** Set when AMIS auto-acted on this item via PostSubmit trigger */
  autoActed?: boolean;
  /** The action that was automatically taken */
  autoActedAction?: SuggestedAction;
  /** Set when the post is a near-duplicate of a previously seen post */
  isDuplicate?: boolean;
  /** The post ID of the original post this is a duplicate of */
  duplicateOf?: string | null;
  /** Cosine similarity to the original post */
  duplicateSimilarity?: number;
  /**
   * Cross-mod sync: set when any moderator explicitly acts on this item
   * (Remove / Approve / Escalate). Items with actionedAt are hidden for ALL
   * mods. Skip does NOT set this field — skipped items remain visible.
   */
  actionedAt?: number;            // Unix ms when action was taken
  actionedBy?: string;            // Moderator username who acted
  actionTaken?: 'remove' | 'approve' | 'escalate';
}
