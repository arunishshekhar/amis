export type InsightType = 'divergence' | 'drift' | 'variance';

export interface ConsistencyInsight {
  id: string;
  type: InsightType;
  detectedAt: number;
  policyId: string | null;
  policyTitle: string | null;
  description: string;
  stats: Record<string, number>;
  acknowledged: boolean;
  acknowledgedAt: number | null;
}
