import type { KVStore, RedditAPIClient } from '@devvit/public-api';
import { Devvit } from '@devvit/public-api';
import type { Metadata } from '@devvit/protos';
import type { VoyageAIClient } from 'voyageai';
import { ingestRules } from '../policy/rule-ingestor';
import { parseAutomodConfig } from '../policy/automod-parser';
import { ingestWikiPages } from '../policy/wiki-ingestor';
import { ingestRemovalReasons } from '../policy/removal-reason-ingestor';
import { embedAndStorePolicies } from '../policy/embedder';
import { savePolicy, clearPolicies } from '../storage/policy-store';

export interface PolicyRefreshResult {
  rulesCount: number;
  automodCount: number;
  wikiCount: number;
  removalCount: number;
}

export async function runPolicyRefresh(
  subredditName: string,
  kv: KVStore,
  embeddingClient: VoyageAIClient,
  reddit: RedditAPIClient,
  metadata: Metadata,
  wikiPages: string[]
): Promise<PolicyRefreshResult> {
  const getRules = async (name: string) => {
    const rsp = await Devvit.redditAPIPlugins.Subreddits.SubredditAboutRules(
      { subreddit: name },
      metadata
    );
    return rsp.rules ?? [];
  };

  const [rules, automod, wiki, removal] = await Promise.all([
    ingestRules(subredditName, getRules),
    parseAutomodConfig(reddit, subredditName),
    ingestWikiPages(reddit, subredditName, wikiPages),
    ingestRemovalReasons(reddit, subredditName),
  ]);

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
