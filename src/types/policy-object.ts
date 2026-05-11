export type PolicySource = 'rule' | 'automod' | 'wiki' | 'removal_reason';

export interface PolicyObject {
  id: string;
  source: PolicySource;
  title: string;
  text: string;
  metadata: Record<string, string>;
}
