import type { RedditAPIClient } from '@devvit/public-api';
import * as yaml from 'js-yaml';
import type { PolicyObject } from '../types/policy-object';

const EXTRACTED_FIELDS = [
  'action', 'type', 'body_text_contains', 'title_text_contains',
  'author', 'url', 'domain', 'flair_text', 'flair_css_class',
];

export async function parseAutomodConfig(
  reddit: RedditAPIClient,
  subredditName: string
): Promise<PolicyObject[]> {
  let content: string;
  try {
    const page = await reddit.getWikiPage(subredditName, 'automoderator');
    content = page.content ?? '';
  } catch {
    console.warn('parseAutomodConfig: automoderator wiki page not found — skipping');
    return [];
  }

  const blocks = content.split(/^---$/m).map((b) => b.trim()).filter(Boolean);
  const policies: PolicyObject[] = [];

  for (let i = 0; i < blocks.length; i++) {
    try {
      const parsed = yaml.load(blocks[i]) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== 'object') continue;

      const extracted: Record<string, string> = {};
      for (const field of EXTRACTED_FIELDS) {
        if (parsed[field] !== undefined) {
          extracted[field] = String(parsed[field]);
        }
      }

      const text = Object.entries(extracted)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ') || `Automod rule ${i}`;

      const title = typeof parsed['name'] === 'string'
        ? parsed['name']
        : `Automod rule ${i}`;

      policies.push({ id: `automod:${i}`, source: 'automod', title, text, metadata: {} });
    } catch (err) {
      console.warn(`parseAutomodConfig: skipping malformed block ${i}:`, err);
    }
  }

  return policies;
}
