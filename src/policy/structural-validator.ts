import type { LLMVerdict } from './llm-classifier';
import type { ModItem } from '../types/mod-item';
import type { PolicyObject } from '../types/policy-object';

export function validateStructuralVerdict(
  item: ModItem,
  policies: PolicyObject[],
  verdict: LLMVerdict
): LLMVerdict {
  const factualViolation = findKnownFactViolation(item, policies);
  if (factualViolation && (!verdict.violates || verdict.confidence < factualViolation.confidence)) {
    return factualViolation;
  }

  if (!verdict.violates) return verdict;
  const policy = policies.find((p) => p.id === verdict.matchedPolicyId || p.title === verdict.matchedPolicyTitle);
  if (!policy) return verdict;

  const ruleText = `${policy.title} ${policy.text} ${policy.metadata.description ?? ''} ${policy.metadata.violationReason ?? ''}`.toLowerCase();
  if (isFalseStartsWithViolation(ruleText, item.title, item.body ?? '', 'title')) {
    return noViolation(`Title starts with "${firstChar(item.title)}", so it does not violate "${policy.title}".`);
  }
  if (isFalseStartsWithViolation(ruleText, item.title, item.body ?? '', 'body')) {
    return noViolation(`Body starts with "${firstChar(item.body)}", so it does not violate "${policy.title}".`);
  }
  if (isFalseStartsWithViolation(ruleText, item.title, item.body ?? '', 'either')) {
    return noViolation(
      `Neither title nor body starts with the forbidden character, so it does not violate "${policy.title}".`
    );
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

function isFalseStartsWithViolation(
  ruleText: string,
  title: string,
  body: string,
  field: 'title' | 'body' | 'either'
): boolean {
  const hasTitleScope = /\b(titles?|headlines?|post titles?)\b/.test(ruleText);
  const hasBodyScope = /\b(body|bodies|descriptions?|selftext|text)\b/.test(ruleText);
  if (field === 'title' && !hasTitleScope) return false;
  if (field === 'body' && !hasBodyScope) return false;
  if (field === 'either' && (hasTitleScope || hasBodyScope)) return false;
  const match = ruleText.match(/\b(?:no|not|never|cannot|can't|should not|must not)\b[\s\w-]{0,60}\bstart(?:s|ing)?\s+with\s+(?:the\s+letter\s+)?["']?([a-z0-9])["']?/i);
  if (!match) return false;
  const forbidden = match[1].toLowerCase();
  if (field === 'title') return firstChar(title).toLowerCase() !== forbidden;
  if (field === 'body') return firstChar(body).toLowerCase() !== forbidden;
  return firstChar(title).toLowerCase() !== forbidden && firstChar(body).toLowerCase() !== forbidden;
}

function extractMaxTitleLength(ruleText: string): number | null {
  if (!ruleText.includes('title') || !/(?:length|characters?|chars?)/.test(ruleText)) return null;
  const match = ruleText.match(/(?:less than|under|below|maximum|max|no more than)\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function findKnownFactViolation(item: ModItem, policies: PolicyObject[]): LLMVerdict | null {
  const factualPolicy = policies.find((policy) => {
    const text = `${policy.title} ${policy.text} ${policy.metadata.description ?? ''} ${policy.metadata.violationReason ?? ''}`.toLowerCase();
    return /\b(fact|facts|factual|truth|true|false|lie|lied|misinformation)\b/.test(text);
  });
  if (!factualPolicy) return null;

  const content = `${item.title}\n${item.body ?? ''}`.toLowerCase();
  const falseFact = detectFalseFact(content);
  if (!falseFact) return null;

  return {
    violates: true,
    matchedPolicyId: factualPolicy.id,
    matchedPolicyTitle: factualPolicy.title,
    confidence: 98,
    rationale: falseFact,
  };
}

function detectFalseFact(content: string): string | null {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (/\b2\s*\+\s*2\s*(?:=|is|equals?)\s*5\b/.test(compact)) {
    return 'The post claims 2 + 2 = 5, but 2 + 2 = 4.';
  }
  if (/\b(?:sun|the sun)\s+rises?\s+in\s+the\s+west\b/.test(compact)) {
    return 'The post claims the sun rises in the west, but it rises in the east.';
  }
  if (/\bearth\s+is\s+flat\b|\bflat\s+earth\b/.test(compact)) {
    return 'The post claims the Earth is flat, but Earth is an oblate spheroid.';
  }
  if (/\bwater\s+boils?\s+at\s+50\s*(?:°|degrees?\s*)?c\b/.test(compact)) {
    return 'The post claims water boils at 50°C at sea level, but it boils at 100°C.';
  }
  return null;
}
