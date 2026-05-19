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

  it('keeps generic starts-with violations when the body matches', () => {
    const policies: PolicyObject[] = [{
      id: 'rule:0',
      source: 'rule',
      title: 'No A start',
      text: 'No posts starting with A',
      metadata: {},
    }];

    const result = validateStructuralVerdict({ ...item, title: 'Fact', body: 'Apple body' }, policies, {
      violates: true,
      matchedPolicyId: 'rule:0',
      matchedPolicyTitle: 'No A start',
      confidence: 95,
      rationale: 'The body starts with A.',
    });

    expect(result.violates).toBe(true);
  });

  it('rejects generic starts-with violations when neither title nor body matches', () => {
    const policies: PolicyObject[] = [{
      id: 'rule:0',
      source: 'rule',
      title: 'No A start',
      text: 'No posts starting with A',
      metadata: {},
    }];

    const result = validateStructuralVerdict({ ...item, title: 'Fact', body: 'Beta body' }, policies, {
      violates: true,
      matchedPolicyId: 'rule:0',
      matchedPolicyTitle: 'No A start',
      confidence: 95,
      rationale: 'The post starts with A.',
    });

    expect(result.violates).toBe(false);
    expect(result.rationale).toContain('Neither title nor body');
  });

  it('overrides false LLM approval for known factual falsehoods in title or body', () => {
    const policies: PolicyObject[] = [{
      id: 'rule:1',
      source: 'rule',
      title: 'Make sure Known facts are not lied',
      text: 'Make sure Known facts are not lied',
      metadata: { description: 'Known facts must be correct.', violationReason: 'Do not lie about known facts.' },
    }];

    const result = validateStructuralVerdict({ ...item, title: 'Wao', body: '2+2 = 5' }, policies, {
      violates: false,
      matchedPolicyId: null,
      matchedPolicyTitle: null,
      confidence: 95,
      rationale: 'No structural rule is violated.',
    });

    expect(result.violates).toBe(true);
    expect(result.matchedPolicyTitle).toBe('Make sure Known facts are not lied');
    expect(result.rationale).toContain('2 + 2 = 4');
  });
});
