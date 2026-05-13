import { Devvit, useState } from '@devvit/public-api';
import type { Recommendation } from '../types/recommendation';
import type { ModItem } from '../types/mod-item';

type HistoryFilter = 'ai' | 'approved' | 'removed' | 'escalated';

// 3 items per page — must fit in ~480px fixed post height without overflowing.
// Overflow causes scroll to bubble to the Reddit page (undesirable).
const ITEMS_PER_PAGE = 3;

interface HistoryViewProps {
  history: Recommendation[];
  modItems: Record<string, ModItem>;
  onBack: () => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function actionBadge(r: Recommendation): string {
  if (r.autoActed) return r.autoActedAction === 'remove' ? '🤖⛔ AI Removed' : '🤖✅ AI Approved';
  if (r.actionTaken === 'remove') return '⛔ Removed';
  if (r.actionTaken === 'approve') return '✅ Approved';
  if (r.actionTaken === 'escalate') return '🔺 Escalated';
  return '🤖 AI Verdict';
}

function actionColor(r: Recommendation): string {
  const a = r.actionTaken ?? r.autoActedAction ?? r.suggestedAction;
  if (a === 'remove') return '#ef4444FF';
  if (a === 'approve') return '#22c55eFF';
  if (a === 'escalate') return '#f97316FF';
  return '#818cf8FF';
}

export function HistoryView({ history, modItems, onBack }: HistoryViewProps): JSX.Element {
  const [page, setPage] = useState(0);
  const [activeFilters, setActiveFilters] = useState<HistoryFilter[]>([]);

  const toggleFilter = (f: HistoryFilter) => {
    if (activeFilters.includes(f)) {
      setActiveFilters(activeFilters.filter((x) => x !== f));
    } else {
      setActiveFilters([...activeFilters, f]);
    }
    setPage(0);
  };

  // AND logic: all selected filters must match
  const filtered = history.filter((r) => {
    if (activeFilters.length === 0) return true;
    return activeFilters.every((f) => {
      switch (f) {
        case 'ai':        return r.autoActed === true;
        case 'approved':  return r.actionTaken === 'approve' || r.autoActedAction === 'approve';
        case 'removed':   return r.actionTaken === 'remove'  || r.autoActedAction === 'remove';
        case 'escalated': return r.actionTaken === 'escalate';
        default:          return true;
      }
    });
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage   = Math.min(page, totalPages - 1);
  const pageItems  = filtered.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

  const bgColor   = '#09090bFF';
  const cardBg    = '#18181bFF';
  const mutedText = '#71717aFF';

  const filterBtn = (label: string, f: HistoryFilter) => (
    <button
      size="small"
      appearance={activeFilters.includes(f) ? 'primary' : 'secondary'}
      onPress={() => toggleFilter(f)}
    >
      {label}
    </button>
  );

  // Compact item card — 2 rows max to keep height predictable
  const renderItem = (r: Recommendation) => {
    const item = modItems[r.itemId];
    const rawTitle = item?.title || item?.body || r.itemId;
    const title = rawTitle.length > 50 ? rawTitle.slice(0, 50) + '…' : rawTitle;
    const badge = actionBadge(r);
    const color = actionColor(r);
    const ts = r.actionedAt ? formatDate(r.actionedAt) : r.generatedAt ? formatDate(r.generatedAt) : '—';
    const actor = r.actionedBy ?? (r.autoActed ? 'AI' : '—');

    return (
      <vstack backgroundColor={cardBg} cornerRadius="small" padding="small" gap="small">
        {/* Row 1: badge + timestamp */}
        <hstack gap="small" alignment="start middle">
          <hstack backgroundColor={`${color.slice(0, 7)}22`} cornerRadius="full" padding="xsmall">
            <text size="xsmall" weight="bold" color={color}>{badge}</text>
          </hstack>
          <spacer grow />
          <text size="xsmall" color={mutedText}>{ts}</text>
        </hstack>
        {/* Row 2: title + actor + confidence */}
        <hstack gap="small" alignment="start middle">
          <text size="xsmall" color="#e4e4e7FF" grow wrap>{title}</text>
        </hstack>
        <hstack gap="small" alignment="start middle">
          <text size="xsmall" color="#818cf8FF">
            {r.matchedPolicyTitle ? `🔖 ${r.matchedPolicyTitle.slice(0, 20)}` : '—'}
          </text>
          <spacer grow />
          <text size="xsmall" color={mutedText}>{actor} · {String(Math.round(r.confidenceScore))}%</text>
        </hstack>
      </vstack>
    );
  };

  return (
    // NOTE: vstack with grow fills the fixed-height post box exactly.
    // Do NOT add overflow or scrollable wrappers — Devvit has none and scroll
    // events will bubble to the Reddit page. Use pagination instead.
    <vstack grow backgroundColor={bgColor} gap="small" padding="xsmall">

      {/* ── Header ──────────────────────────────────────── */}
      <hstack gap="small" alignment="start middle" padding="small" backgroundColor={cardBg}>
        <button appearance="plain" size="small" onPress={onBack}>← Back</button>
        <text weight="bold" size="medium" color="#e4e4e7FF">📋 History</text>
        <spacer grow />
        <text size="xsmall" color={mutedText}>
          {String(filtered.length)} item{filtered.length !== 1 ? 's' : ''}
        </text>
      </hstack>

      {/* ── Filter chips (AND logic) ─────────────────────── */}
      <hstack gap="small" padding="xsmall" alignment="start middle">
        {filterBtn('🤖 AI', 'ai')}
        {filterBtn('✅ OK', 'approved')}
        {filterBtn('⛔ Rmv', 'removed')}
        {filterBtn('🔺 Esc', 'escalated')}
        {activeFilters.length > 0 && (
          <button size="small" appearance="plain" onPress={() => setActiveFilters([])}>✕</button>
        )}
        <spacer grow />
        {activeFilters.length > 1 && (
          <text size="xsmall" color="#818cf8FF">AND</text>
        )}
      </hstack>

      {/* ── Item list (fixed 3 slots) ────────────────────── */}
      {pageItems.length === 0 ? (
        <vstack alignment="center middle" grow>
          <text color={mutedText} size="small">
            {history.length === 0
              ? 'No history yet — actions appear here'
              : 'No items match filters'}
          </text>
        </vstack>
      ) : (
        <vstack gap="small" grow>
          {pageItems.map((r) => renderItem(r))}
        </vstack>
      )}

      {/* ── Pagination ─────────────────────────────────── */}
      <hstack alignment="center middle" gap="medium" padding="xsmall">
        <button
          size="small"
          appearance="secondary"
          onPress={() => setPage(Math.max(0, safePage - 1))}
        >
          ← Prev
        </button>
        <text size="xsmall" color={mutedText}>
          {String(safePage + 1)} / {String(totalPages)}
        </text>
        <button
          size="small"
          appearance="secondary"
          onPress={() => setPage(Math.min(totalPages - 1, safePage + 1))}
        >
          Next →
        </button>
      </hstack>

    </vstack>
  );
}
