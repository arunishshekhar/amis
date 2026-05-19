import { ingestRules } from '../../src/policy/rule-ingestor';
import type { SubredditRule } from '../../src/policy/rule-ingestor';

const makeGetRules = (rules: SubredditRule[]) =>
  jest.fn().mockResolvedValue(rules);

describe('ingestRules', () => {
  it('maps each rule to a PolicyObject', async () => {
    const getRules = makeGetRules([
      { shortName: 'No spam', description: 'Do not post spam.', priority: 0 },
      { shortName: 'Be civil', description: 'Treat others with respect.', priority: 1 },
    ]);

    const result = await ingestRules('testsubreddit', getRules);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'rule:0',
      source: 'rule',
      title: 'No spam',
      text: 'No spam\n\nDescription: Do not post spam.',
      metadata: { priority: '0', description: 'Do not post spam.' },
    });
    expect(result[1]).toEqual({
      id: 'rule:1',
      source: 'rule',
      title: 'Be civil',
      text: 'Be civil\n\nDescription: Treat others with respect.',
      metadata: { priority: '1', description: 'Treat others with respect.' },
    });
  });

  it('falls back to "Rule N" title when shortName is missing', async () => {
    const getRules = makeGetRules([{ description: 'Some rule.' }]);
    const result = await ingestRules('testsubreddit', getRules);
    expect(result[0].title).toBe('Rule 1');
    expect(result[0].text).toBe('Rule 1\n\nDescription: Some rule.');
  });

  it('returns empty array when no rules', async () => {
    const getRules = makeGetRules([]);
    const result = await ingestRules('testsubreddit', getRules);
    expect(result).toEqual([]);
  });

  it('passes subredditName to getRules', async () => {
    const getRules = makeGetRules([]);
    await ingestRules('mysubreddit', getRules);
    expect(getRules).toHaveBeenCalledWith('mysubreddit');
  });
});
