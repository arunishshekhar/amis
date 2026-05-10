export type ContentType = 'post' | 'comment';

export interface ModItem {
  id: string;
  author: string;
  timestamp: number; // Unix ms
  title: string;     // empty string for comments
  body: string;
  reportReasons: string[];
  contentType: ContentType;
  subredditId: string;
}
