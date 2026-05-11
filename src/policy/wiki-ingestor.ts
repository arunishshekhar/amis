import type { RedditAPIClient } from '@devvit/public-api';
import type { PolicyObject } from '../types/policy-object';

export function chunkText(text: string, maxChunkSize = 500): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

export async function ingestWikiPages(
  reddit: RedditAPIClient,
  subredditName: string,
  pageNames: string[]
): Promise<PolicyObject[]> {
  const policies: PolicyObject[] = [];

  for (const pageName of pageNames) {
    try {
      const page = await reddit.getWikiPage(subredditName, pageName.trim());
      const chunks = chunkText(page.content ?? '');
      for (let i = 0; i < chunks.length; i++) {
        policies.push({
          id: `wiki:${pageName}:${i}`,
          source: 'wiki',
          title: `${pageName}:${i}`,
          text: chunks[i],
          metadata: { page: pageName },
        });
      }
    } catch {
      console.warn(`ingestWikiPages: skipping page "${pageName}" — not accessible`);
    }
  }

  return policies;
}
