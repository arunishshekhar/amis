import type { KVStore, RedditAPIClient } from '@devvit/public-api';
import { Devvit } from '@devvit/public-api';
import type { Metadata } from '@devvit/protos';
import type { EmbeddingClient } from '../ai/types';
import { ingestRules } from '../policy/rule-ingestor';
import { parseAutomodConfig } from '../policy/automod-parser';
import { ingestWikiPages } from '../policy/wiki-ingestor';
import { ingestRemovalReasons } from '../policy/removal-reason-ingestor';
import { embedAndStorePolicies } from '../policy/embedder';
import { savePolicy, clearPolicies } from '../storage/policy-store';
import type { PolicyObject } from '../types/policy-object';

export interface PolicyRefreshResult {
  rulesCount: number;
  automodCount: number;
  wikiCount: number;
  removalCount: number;
}

function policyList(value: unknown): PolicyObject[] {
  return Array.isArray(value) ? value : [];
}

export async function runPolicyRefresh(
  subredditName: string,
  kv: KVStore,
  embeddingClient: EmbeddingClient,
  reddit: RedditAPIClient,
  metadata: Metadata,
  wikiPages: string[]
): Promise<PolicyRefreshResult> {
  const getRules = async (name: string) => {
    try {
      const directRules = await reddit.getRules(name);
      if (Array.isArray(directRules)) return directRules;
    } catch (err) {
      console.warn(`runPolicyRefresh: reddit.getRules failed for r/${name}:`, err);
    }

    try {
      const rsp = await (Devvit as any).redditAPIPlugins.Subreddits.SubredditAboutRules(
        { subreddit: name },
        metadata
      );
      if (!Array.isArray(rsp?.rules)) {
        console.warn(`runPolicyRefresh: subreddit rules unavailable for r/${name}`);
        return [];
      }
      return rsp.rules;
    } catch (err) {
      console.warn(`runPolicyRefresh: failed to fetch subreddit rules for r/${name}:`, err);
      return [];
    }
  };

  const [rawRules, rawAutomod, rawWiki, rawRemoval] = await Promise.all([
    ingestRules(subredditName, getRules),
    parseAutomodConfig(reddit, subredditName),
    ingestWikiPages(reddit, subredditName, wikiPages),
    ingestRemovalReasons(reddit, subredditName),
  ]);
  const rules = policyList(rawRules);
  const automod = policyList(rawAutomod);
  const wiki = policyList(rawWiki);
  const removal = policyList(rawRemoval);

  await clearPolicies(kv);

  const all = [...rules, ...automod, ...wiki, ...removal];
  await Promise.all(all.map((p) => savePolicy(kv, p)));
  await embedAndStorePolicies(kv, embeddingClient, all);

  return {
    rulesCount: rules.length,
    automodCount: automod.length,
    wikiCount: wiki.length,
    removalCount: removal.length,
  };
}
