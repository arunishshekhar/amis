import { Devvit } from '@devvit/public-api';
import type { Recommendation, RiskLevel } from '../types/recommendation';
import type { ModItem } from '../types/mod-item';
import { riskColor, confidenceColor, truncate } from './helpers';

const RISK_LABELS: Record<RiskLevel, string> = {
  high: 'HIGH RISK',
  medium: 'MEDIUM',
  low: 'LOW',
};

interface TriageViewProps {
  recs: Recommendation[];
  modItems: Record<string, ModItem>;
  itemIndex: number;
  pendingInsightCount: number;
  directActionsEnabled: boolean;
  fullscreenEnabled: boolean;
  subredditName: string;
  onRemoveDirect: (id: string) => void | Promise<void>;
  onApproveDirect: (id: string) => void | Promise<void>;
  onNavigateToQueue: () => void;
  onSkip: () => void;
  onEscalate: (id: string) => void | Promise<void>;
  onViewInsights: () => void;
  onViewSettings: () => void;
  onRefresh: () => void | Promise<void>;
}

export function TriageView({
  recs,
  modItems,
  itemIndex,
  pendingInsightCount,
  directActionsEnabled,
  fullscreenEnabled,
  subredditName,
  onRemoveDirect,
  onApproveDirect,
  onNavigateToQueue,
  onSkip,
  onEscalate,
  onViewInsights,
  onViewSettings,
  onRefresh,
}: TriageViewProps): JSX.Element {
  const header = (
    <vstack gap="small">
      <hstack gap="small" alignment="start middle" padding="small" border="thin">
        <text weight="bold" size="medium">⚡ AMIS</text>
        <spacer grow />
        <button appearance="plain" size="small" onPress={onViewInsights}>
          💡 {pendingInsightCount}
        </button>
        <button appearance="plain" size="small" onPress={onViewSettings}>⚙</button>
      </hstack>
      {fullscreenEnabled && (
        <text size="xsmall" color="#a0a0ff">
          Full screen dashboard active
        </text>
      )}
    </vstack>
  );

  if (recs.length === 0 || itemIndex >= recs.length) {
    return (
      <vstack grow padding={fullscreenEnabled ? 'medium' : undefined} backgroundColor={fullscreenEnabled ? '#040416FF' : undefined}>
        {header}
        <vstack alignment="center middle" grow gap="medium">
          <text size="large">Queue clear ✓</text>
          <text color="#888888">Nothing left to review</text>
          <button size="small" appearance="secondary" onPress={onRefresh}>
            Refresh ↻
          </button>
        </vstack>
      </vstack>
    );
  }

  const rec = recs[itemIndex];
  const item = modItems[rec.itemId];
  const rawDisplay = item
    ? (item.contentType === 'post' && item.title ? item.title : item.body)
    : rec.itemId;
  const displayTitle = truncate(rawDisplay, 80);
  const author = item?.author ?? '—';
  const contentType = item?.contentType ?? '—';
  const reportCount = item?.reportReasons?.length ?? 0;

  const high = recs.filter((r) => r.riskLevel === 'high').length;
  const medium = recs.filter((r) => r.riskLevel === 'medium').length;
  const low = recs.filter((r) => r.riskLevel === 'low').length;

  // Auto-act badge
  const autoActBadge = rec.autoActed ? (
    <hstack backgroundColor={rec.autoActedAction === 'remove' ? '#7f1d1dFF' : '#14532dFF'}
      cornerRadius="small" padding="xsmall" gap="small">
      <text size="xsmall" weight="bold" color={rec.autoActedAction === 'remove' ? '#fca5a5' : '#86efac'}>
        {rec.autoActedAction === 'remove' ? '⛔ AUTO-REMOVED' : '✅ AUTO-APPROVED'}
      </text>
    </hstack>
  ) : null;

  const handleRemove = directActionsEnabled
    ? () => onRemoveDirect(rec.itemId)
    : onNavigateToQueue;

  const handleApprove = directActionsEnabled
    ? () => onApproveDirect(rec.itemId)
    : onNavigateToQueue;

  if (fullscreenEnabled) {
    return (
      <vstack grow padding="medium" backgroundColor="#040416FF" gap="medium">
        {header}
        <hstack gap="medium" grow>
          <vstack grow gap="small">
            <vstack backgroundColor="#0f0f2aFF" cornerRadius="small" padding="medium" gap="small" grow>
              <hstack gap="small" alignment="start middle">
                <text weight="bold" color={riskColor(rec.riskLevel)} size="small">
                  {RISK_LABELS[rec.riskLevel]}
                </text>
                <text weight="bold" size="xxlarge" color={confidenceColor(rec.confidenceScore)}>
                  {String(rec.confidenceScore)}%
                </text>
                <text color="#888888" size="xsmall">confidence</text>
              </hstack>
              {autoActBadge}

              <text weight="bold" wrap size="large">{displayTitle}</text>
              <text size="small" color="#888888">
                {contentType} · u/{author} · {String(reportCount)} report{reportCount !== 1 ? 's' : ''}
              </text>

              <vstack backgroundColor="#1a1a2eFF" cornerRadius="small" padding="small" gap="small">
                <text size="xsmall" color="#a0a0ff" weight="bold">MATCHED RULE</text>
                <text size="small">
                  {rec.matchedPolicyTitle ?? 'No match'} — {rec.similarity.toFixed(2)}
                </text>
              </vstack>

              <vstack backgroundColor="#1a1a2eFF" cornerRadius="small" padding="small" gap="small" grow>
                <text size="xsmall" color="#a0a0ff" weight="bold">RATIONALE</text>
                <text size="small" wrap>{rec.rationale}</text>
              </vstack>
            </vstack>

            <hstack alignment="center middle" gap="small">
              <text size="xsmall" color="#888888">
                Item {String(itemIndex + 1)} of {String(recs.length)} · {String(high)} high · {String(medium)} med · {String(low)} low
              </text>
            </hstack>
          </vstack>

          <vstack width="33%" gap="small">
            <vstack backgroundColor="#0f0f2aFF" cornerRadius="small" padding="small" gap="small">
              <text size="xsmall" color="#a0a0ff" weight="bold">ACTIONS</text>
              <button size="small" appearance="destructive" onPress={handleRemove}>
                {directActionsEnabled ? 'Remove' : 'Remove ↗'}
              </button>
              <button size="small" appearance="success" onPress={handleApprove}>
                {directActionsEnabled ? 'Approve' : 'Approve ↗'}
              </button>
              <button size="small" appearance="secondary" onPress={onSkip}>Skip →</button>
              <button size="small" appearance="caution" onPress={() => onEscalate(rec.itemId)}>
                Escalate
              </button>
            </vstack>

            <vstack backgroundColor="#0f0f2aFF" cornerRadius="small" padding="small" gap="small">
              <text size="xsmall" color="#a0a0ff" weight="bold">QUEUE SUMMARY</text>
              <text size="small">{String(recs.length)} total items</text>
              <text size="small">{String(high)} high risk</text>
              <text size="small">{String(medium)} medium risk</text>
              <text size="small">{String(low)} low risk</text>
              <button size="small" appearance="secondary" onPress={onRefresh}>Refresh ↻</button>
            </vstack>
          </vstack>
        </hstack>
      </vstack>
    );
  }

  return (
    <vstack grow>
      {header}
      <vstack padding="small" gap="small" grow>
        <hstack gap="small" alignment="start middle">
          <text weight="bold" color={riskColor(rec.riskLevel)} size="small">
            {RISK_LABELS[rec.riskLevel]}
          </text>
          <text weight="bold" size="xxlarge" color={confidenceColor(rec.confidenceScore)}>
            {String(rec.confidenceScore)}%
          </text>
          <text color="#888888" size="xsmall">confidence</text>
        </hstack>
        {autoActBadge}

        <text weight="bold" wrap size="medium">{displayTitle}</text>
        <text size="xsmall" color="#888888">
          {contentType} · u/{author} · {String(reportCount)} report{reportCount !== 1 ? 's' : ''}
        </text>

        <vstack backgroundColor="#1a1a2eFF" cornerRadius="small" padding="small" gap="small">
          <text size="xsmall" color="#a0a0ff" weight="bold">MATCHED RULE</text>
          <text size="small">
            {rec.matchedPolicyTitle ?? 'No match'} — {rec.similarity.toFixed(2)}
          </text>
        </vstack>

        <vstack backgroundColor="#1a1a2eFF" cornerRadius="small" padding="small" gap="small">
          <text size="xsmall" color="#a0a0ff" weight="bold">RATIONALE</text>
          <text size="small" wrap>{rec.rationale}</text>
        </vstack>

        <hstack gap="small">
          <button size="small" appearance="destructive" onPress={handleRemove}>
            {directActionsEnabled ? 'Remove' : 'Remove ↗'}
          </button>
          <button size="small" appearance="success" onPress={handleApprove}>
            {directActionsEnabled ? 'Approve' : 'Approve ↗'}
          </button>
          <button size="small" appearance="secondary" onPress={onSkip}>Skip →</button>
          <button size="small" appearance="caution" onPress={() => onEscalate(rec.itemId)}>
            Escalate
          </button>
        </hstack>

        <hstack alignment="center middle">
          <text size="xsmall" color="#888888">
            Item {String(itemIndex + 1)} of {String(recs.length)} · {String(high)} high · {String(medium)} med · {String(low)} low
          </text>
        </hstack>
      </vstack>
    </vstack>
  );
}
