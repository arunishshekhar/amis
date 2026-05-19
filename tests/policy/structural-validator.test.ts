import { validateStructuralVerdict } from '../../src/policy/structural-validator';
import type { ModItem } from '../../src/types/mod-item';
import type { PolicyObject } from '../../src/types/policy-object';

const item: ModItem = {
  id: 't3_post',
  author: 'alice',
  timestamp: 1,
  title: 'Fact',
  body: '',
  reportReasons: [],
  contentType: 'post',
  subredditId: 'sub',
  editedAt: 0,
};

describe('validateStructuralVerdict', () => {
  it('rejects false title-starts-with violations', () => {
    const policies: PolicyObject[] = [{
      id: 'rule:0',
      source: 'rule',
      title: 'NO A Start',
      text: 'No titles starting with A',
      metadata: {},
    }];

    const result = validateStructuralVerdict(item, policies, {
      violates: true,
      matchedPolicyId: 'rule:0',
      matchedPolicyTitle: 'NO A Start',
      confidence: 95,
      rationale: 'The title starts with A.',
    });

    expect(result.violates).toBe(false);
    expect(result.rationale).toContain('Title starts with "F"');
  });

  it('keeps true title-starts-with violations', () => {
    const policies: PolicyObject[] = [{
      id: 'rule:0',
      source: 'rule',
      title: 'NO A Start',
      text: 'No titles starting with A',
      metadata: {},
    }];

    const result = validateStructuralVerdict({ ...item, title: 'Apple' }, policies, {
      violates: true,
      matchedPolicyId: 'rule:0',
      matchedPolicyTitle: 'NO A Start',
      confidence: 95,
      rationale: 'The title starts with A.',
    });

    expect(result.violates).toBe(true);
  });
});
