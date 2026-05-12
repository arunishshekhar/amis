import { Devvit } from '@devvit/public-api';
import type { ConsistencyInsight } from '../types/consistency-insight';
import { sortedInsights, formatStats } from './helpers';

const BADGE_COLORS: Record<string, string> = {
  divergence: '#3498db',
  drift: '#e67e22',
  variance: '#8e44ad',
};

interface InsightsViewProps {
  insights: ConsistencyInsight[];
  onBack: () => void;
  onAcknowledge: (id: string) => void | Promise<void>;
}

export function InsightsView({ insights, onBack, onAcknowledge }: InsightsViewProps): JSX.Element {
  const pending = insights.filter((i) => !i.acknowledged);
  const sorted = sortedInsights(pending);

  if (sorted.length === 0) {
    return (
      <vstack padding="medium" gap="medium" grow>
        <hstack gap="small" alignment="start middle">
          <button appearance="plain" size="small" onPress={onBack}>← Back</button>
          <text weight="bold" size="medium">Insights</text>
        </hstack>
        <vstack alignment="center middle" grow>
          <text color="#888888">No pending insights — consistency looks good</text>
        </vstack>
      </vstack>
    );
  }

  return (
    <vstack padding="medium" gap="small" grow>
      <hstack gap="small" alignment="start middle">
        <button appearance="plain" size="small" onPress={onBack}>← Back</button>
        <text weight="bold" size="medium">Insights</text>
        <spacer grow />
        <text color="#888888" size="small">{sorted.length} pending</text>
      </hstack>

      <vstack gap="small">
        {sorted.map((insight) => (
          <vstack
            padding="small"
            gap="small"
            border="thin"
            cornerRadius="small"
            backgroundColor="#1a1a2e"
          >
            <hstack gap="small" alignment="start middle">
              <text
                weight="bold"
                size="small"
                color={BADGE_COLORS[insight.type] ?? '#888888'}
              >
                {insight.type.toUpperCase()}
              </text>
              {insight.policyTitle ? (
                <text weight="bold" size="small">{insight.policyTitle}</text>
              ) : null}
            </hstack>
            <text wrap size="small">{insight.description}</text>
            <text size="xsmall" color="#888888">{formatStats(insight.stats)}</text>
            <button
              size="small"
              appearance="secondary"
              onPress={() => onAcknowledge(insight.id)}
            >
              Acknowledge ✓
            </button>
          </vstack>
        ))}
      </vstack>
    </vstack>
  );
}
