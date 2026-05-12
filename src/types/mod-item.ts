export type ContentType = 'post' | 'comment';

export interface ModItem {
  id: string;
  author: string;
  timestamp: number; // Unix ms (created)
  editedAt: number;  // Unix ms (last edit, or 0 if never edited — used to skip re-analysis)
  title: string;     // empty string for comments
  body: string;
  reportReasons: string[];
  contentType: ContentType;
  subredditId: string;
}
