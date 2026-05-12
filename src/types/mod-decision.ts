export type ModAction =
  | 'removelink'
  | 'approvelink'
  | 'removecomment'
  | 'approvecomment'
  | 'spamlink'
  | 'spamcomment';

export interface ModDecision {
  targetId: string;
  action: ModAction;
  moderator: string;
  timestamp: number;
  subredditId: string;
}
