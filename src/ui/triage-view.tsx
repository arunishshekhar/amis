import { Devvit, useState, useInterval } from '@devvit/public-api';
import type { Recommendation, RiskLevel } from '../types/recommendation';
import type { ModItem } from '../types/mod-item';
import { riskColor, confidenceColor, truncate } from './helpers';

const RISK_LABELS: Record<RiskLevel, string> = {
  high: '⛔ HIGH RISK',
  medium: '⚠️ MEDIUM',
  low: '✅ LOW',
};

const RISK_BAR_COLOR: Record<RiskLevel, string> = {
  high: '#ef4444FF',
  medium: '#f97316FF',
  low: '#22c55eFF',
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
  // Transition animation: briefly show a loading card when advancing items
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimer = useInterval(() => {
    setIsTransitioning(false);
    transitionTimer.stop();
  }, 120);

  const triggerTransition = (action: () => void | Promise<void>) => {
    setIsTransitioning(true);
    transitionTimer.start();
    action();
  };

  const bgColor = '#09090bFF';       // zinc-950
  const cardBg = '#18181bFF';        // zinc-900
  const cardBorder = '#27272aFF';    // zinc-800
  const mutedText = '#71717aFF';     // zinc-500
  const subtleText = '#a1a1aaFF';    // zinc-400

  const header = (
    <hstack gap="small" alignment="start middle" padding="small"
      backgroundColor={cardBg} border="thin">
      <text weight="bold" size="medium" color="#e4e4e7FF">⚡ AMIS</text>
      <spacer grow />
      {/* Insights button — always visible, highlighted when pending */}
      <button appearance="plain" size="small" onPress={onViewInsights}>
        {pendingInsightCount > 0
          ? `💡 ${String(pendingInsightCount)}`
          : '💡 0'
        }
      </button>
      <button appearance="plain" size="small" onPress={onViewSettings}>⚙️</button>
    </hstack>
  );

  // Empty / complete state
  if (recs.length === 0 || itemIndex >= recs.length) {
    return (
      <vstack grow backgroundColor={bgColor}>
        {header}
        <vstack alignment="center middle" grow gap="medium">
          <text size="xxlarge">✅</text>
          <text size="large" color="#e4e4e7FF" weight="bold">Queue clear</text>
          <text color={mutedText} size="small">No posts need review right now</text>
          <button size="small" appearance="secondary" onPress={onRefresh}>
            Refresh ↻
          </button>
        </vstack>
      </vstack>
    );
  }

  // Transition: show next item dimmed for a smoother feel
  // We use isTransitioning to render at reduced opacity by showing a
  // placeholder post-card with just the title of the next item.
  const nextRec = isTransitioning && recs.length > 0
    ? recs[Math.min(itemIndex, recs.length - 1)]
    : null;
  if (isTransitioning && nextRec) {
    const nextItem = modItems[nextRec.itemId];
    const nextTitle = nextItem
      ? truncate(nextItem.contentType === 'post' && nextItem.title ? nextItem.title : nextItem.body, 80)
      : '...';
    return (
      <vstack grow backgroundColor={bgColor}>
        {header}
        <vstack padding="small" gap="small" grow>
          <vstack backgroundColor={cardBg} cornerRadius="medium" padding="medium" gap="small" grow>
            <hstack gap="small" alignment="start middle">
              <hstack backgroundColor="#27272aFF" cornerRadius="full" padding="xsmall">
                <text size="xsmall" color="#52525bFF" weight="bold">⋯</text>
              </hstack>
            </hstack>
            <text weight="bold" wrap size="medium" color="#3f3f46FF">{nextTitle}</text>
            <text size="xsmall" color="#3f3f46FF">• • •</text>
          </vstack>
          <hstack gap="small" alignment="center middle">
            <button size="small" appearance="destructive" onPress={() => {}}>⛔ Remove</button>
            <button size="small" appearance="success" onPress={() => {}}>✅ Approve</button>
            <button size="small" appearance="secondary" onPress={() => {}}>Skip →</button>
            <button size="small" appearance="caution" onPress={() => {}}>🔺 Escalate</button>
          </hstack>
        </vstack>
      </vstack>
    );
  }

  const rec = recs[itemIndex];
  const item = modItems[rec.itemId];
  const rawDisplay = item
    ? (item.contentType === 'post' && item.title ? item.title : item.body)
    : rec.itemId;
  const displayTitle = truncate(rawDisplay, 90);
  const author = item?.author ?? '—';
  const contentType = item?.contentType ?? '—';
  const reportCount = item?.reportReasons?.length ?? 0;

  const high = recs.filter((r) => r.riskLevel === 'high').length;
  const medium = recs.filter((r) => r.riskLevel === 'medium').length;
  const low = recs.filter((r) => r.riskLevel === 'low').length;

  const riskBorderColor = RISK_BAR_COLOR[rec.riskLevel];
  const confidenceWidth = Math.round(rec.confidenceScore);

  // All action buttons always call the handler — parent decides whether
  // to call Reddit API based on directActionsEnabled.
  const handleRemove = () => triggerTransition(() => onRemoveDirect(rec.itemId));
  const handleApprove = () => triggerTransition(() => onApproveDirect(rec.itemId));
  const handleEscalate = () => triggerTransition(() => onEscalate(rec.itemId));
  const handleSkip = () => triggerTransition(onSkip);

  // Auto-act badge
  const autoActBadge = rec.autoActed ? (
    <hstack
      backgroundColor={rec.autoActedAction === 'remove' ? '#450a0aFF' : '#052e16FF'}
      cornerRadius="small" padding="xsmall" gap="small"
    >
      <text size="xsmall" weight="bold"
        color={rec.autoActedAction === 'remove' ? '#fca5a5FF' : '#86efacFF'}>
        {rec.autoActedAction === 'remove' ? '⛔ AUTO-REMOVED' : '✅ AUTO-APPROVED'}
      </text>
    </hstack>
  ) : null;

  // Duplicate badge
  const dupBadge = rec.isDuplicate ? (
    <hstack backgroundColor="#2d1b69FF" cornerRadius="small" padding="xsmall">
      <text size="xsmall" color="#c4b5fdFF" weight="bold">
        🔁 DUPLICATE ({String(Math.round((rec.duplicateSimilarity ?? 0) * 100))}% match)
      </text>
    </hstack>
  ) : null;

  // Main card content (shared between normal and fullscreen)
  const postCard = (
    <vstack backgroundColor={cardBg} cornerRadius="medium" padding="medium" gap="small" grow>

      {/* Risk + confidence row */}
      <hstack gap="small" alignment="start middle">
        <hstack backgroundColor={`${riskBorderColor.slice(0, 7)}22`}
          cornerRadius="full" padding="xsmall">
          <text size="xsmall" weight="bold" color={riskBorderColor}>
            {RISK_LABELS[rec.riskLevel]}
          </text>
        </hstack>
        <spacer grow />
        <text size="xlarge" weight="bold" color={confidenceColor(rec.confidenceScore)}>
          {String(confidenceWidth)}%
        </text>
        <text size="xsmall" color={mutedText}>confidence</text>
      </hstack>

      {/* Confidence bar */}
      <hstack backgroundColor={cardBorder} cornerRadius="full" height="4px">
        <hstack
          backgroundColor={riskBorderColor}
          cornerRadius="full"
          height="4px"
          width={`${confidenceWidth}%`}
        />
      </hstack>

      {autoActBadge}
      {dupBadge}

      {/* Post title */}
      <text weight="bold" wrap size="medium" color="#f4f4f5FF">{displayTitle}</text>
      <text size="xsmall" color={mutedText}>
        {contentType} · u/{author}
        {reportCount > 0 ? ` · 🚩 ${String(reportCount)} report${reportCount !== 1 ? 's' : ''}` : ''}
      </text>

      {/* Matched rule */}
      <vstack backgroundColor="#0c0c14FF" cornerRadius="small" padding="small" gap="small">
        <hstack gap="small" alignment="start middle">
          <text size="xsmall" color="#818cf8FF" weight="bold">🔖 MATCHED RULE</text>
        </hstack>
        <text size="small" color="#c7d2feFF">
          {rec.matchedPolicyTitle ?? 'No rule matched'} — {rec.similarity.toFixed(2)}
        </text>
      </vstack>

      {/* Rationale */}
      <vstack backgroundColor="#0c0c14FF" cornerRadius="small" padding="small" gap="small">
        <text size="xsmall" color="#818cf8FF" weight="bold">💬 RATIONALE</text>
        <text size="xsmall" color={subtleText} wrap>{rec.rationale}</text>
      </vstack>
    </vstack>
  );

  const actionButtons = (
    <hstack gap="small" alignment="center middle">
      <button size="small" appearance="destructive" onPress={handleRemove}>⛔ Remove</button>
      <button size="small" appearance="success" onPress={handleApprove}>✅ Approve</button>
      <button size="small" appearance="secondary" onPress={handleSkip}>Skip →</button>
      <button size="small" appearance="caution" onPress={handleEscalate}>🔺 Escalate</button>
    </hstack>
  );

  const progressRow = (
    <hstack alignment="center middle" gap="small">
      <text size="xsmall" color={mutedText}>
        {String(itemIndex + 1)} / {String(recs.length)}
      </text>
      <spacer grow />
      {high > 0 && <text size="xsmall" color="#ef4444FF">⛔ {String(high)}</text>}
      {medium > 0 && <text size="xsmall" color="#f97316FF">⚠ {String(medium)}</text>}
      {low > 0 && <text size="xsmall" color="#22c55eFF">✅ {String(low)}</text>}
    </hstack>
  );

  if (fullscreenEnabled) {
    return (
      <vstack grow padding="small" backgroundColor={bgColor} gap="small">
        {header}
        <hstack gap="small" grow>
          <vstack grow gap="small">
            {postCard}
            {actionButtons}
            {progressRow}
          </vstack>

          {/* Side panel */}
          <vstack width="28%" gap="small">
            <vstack backgroundColor={cardBg} cornerRadius="medium" padding="small" gap="small">
              <text size="xsmall" color="#818cf8FF" weight="bold">QUEUE SUMMARY</text>
              <text size="small" color="#e4e4e7FF">{String(recs.length)} total</text>
              {high > 0 && <text size="small" color="#ef4444FF">{String(high)} high risk</text>}
              {medium > 0 && <text size="small" color="#f97316FF">{String(medium)} medium</text>}
              {low > 0 && <text size="small" color="#22c55eFF">{String(low)} low</text>}
              <button size="small" appearance="secondary" onPress={onRefresh}>Refresh ↻</button>
            </vstack>
          </vstack>
        </hstack>
      </vstack>
    );
  }

  return (
    <vstack grow backgroundColor={bgColor} gap="small" padding="xsmall">
      {header}
      {postCard}
      {actionButtons}
      {progressRow}
    </vstack>
  );
}
