import type { LLMVerdict } from './llm-classifier';
import type { ModItem } from '../types/mod-item';
import type { PolicyObject } from '../types/policy-object';

export function validateStructuralVerdict(
  item: ModItem,
  policies: PolicyObject[],
  verdict: LLMVerdict
): LLMVerdict {
  if (!verdict.violates) return verdict;
  const policy = policies.find((p) => p.id === verdict.matchedPolicyId || p.title === verdict.matchedPolicyTitle);
  if (!policy) return verdict;

  const ruleText = `${policy.title} ${policy.text} ${policy.metadata.description ?? ''}`.toLowerCase();
  if (isFalseStartsWithViolation(ruleText, item.title, ['title', 'post'])) {
    return noViolation(`Title starts with "${firstChar(item.title)}", so it does not violate "${policy.title}".`);
  }
  if (isFalseStartsWithViolation(ruleText, item.body ?? '', ['body', 'description', 'selftext'])) {
    return noViolation(`Body starts with "${firstChar(item.body)}", so it does not violate "${policy.title}".`);
  }

  const maxTitleLength = extractMaxTitleLength(ruleText);
  if (maxTitleLength != null && item.title.length < maxTitleLength) {
    return noViolation(`Title length is ${item.title.length}, which is below the ${maxTitleLength} character limit.`);
  }

  return verdict;
}

function noViolation(rationale: string): LLMVerdict {
  return {
    violates: false,
    matchedPolicyId: null,
    matchedPolicyTitle: null,
    confidence: 95,
    rationale,
  };
}

function firstChar(value?: string): string {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed[0] : 'nothing';
}

function isFalseStartsWithViolation(ruleText: string, value: string, fieldWords: string[]): boolean {
  if (!fieldWords.some((word) => ruleText.includes(word))) return false;
  const match = ruleText.match(/\b(?:no|not|never|cannot|can't|should not|must not)\b[\s\w-]{0,60}\bstart(?:s|ing)?\s+with\s+(?:the\s+letter\s+)?["']?([a-z0-9])["']?/i);
  if (!match) return false;
  return firstChar(value).toLowerCase() !== match[1].toLowerCase();
}

function extractMaxTitleLength(ruleText: string): number | null {
  if (!ruleText.includes('title') || !/(?:length|characters?|chars?)/.test(ruleText)) return null;
  const match = ruleText.match(/(?:less than|under|below|maximum|max|no more than)\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}
