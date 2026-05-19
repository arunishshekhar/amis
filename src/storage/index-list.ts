export function parseIndexList(raw: unknown): string[] {
  if (raw == null || raw === '') return [];

  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  if (Array.isArray(parsed)) {
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  if (typeof parsed === 'string') return parsed ? [parsed] : [];
  return [];
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
