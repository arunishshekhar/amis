import { Devvit } from '@devvit/public-api';

interface SettingsViewProps {
  aiProvider: string;
  directActionsEnabled: boolean;
  itemCount: number;
  onBack: () => void;
  onToggleDirectActions: () => void | Promise<void>;
  onRefreshQueue: () => void | Promise<void>;
}

export function SettingsView({
  aiProvider,
  directActionsEnabled,
  itemCount,
  onBack,
  onToggleDirectActions,
  onRefreshQueue,
}: SettingsViewProps): JSX.Element {
  return (
    <vstack padding="medium" gap="medium" grow>
      <hstack gap="small" alignment="start middle">
        <button appearance="plain" size="small" onPress={onBack}>← Back</button>
        <text weight="bold" size="medium">Settings</text>
      </hstack>

      <vstack gap="small" padding="small" backgroundColor="#1a1a2e" cornerRadius="small">
        <text size="xsmall" color="#a0a0ff" weight="bold">AI PROVIDER</text>
        <text size="small">{aiProvider}</text>
      </vstack>

      <vstack gap="small" padding="small" backgroundColor="#1a1a2e" cornerRadius="small">
        <text size="xsmall" color="#a0a0ff" weight="bold">DIRECT ACTIONS</text>
        <text size="xsmall" color="#888888" wrap>
          Execute remove/approve from dashboard without leaving Reddit
        </text>
        <hstack alignment="start middle" gap="small">
          <text size="small" weight="bold">{directActionsEnabled ? 'ON' : 'OFF'}</text>
          <button
            size="small"
            appearance={directActionsEnabled ? 'destructive' : 'secondary'}
            onPress={onToggleDirectActions}
          >
            {directActionsEnabled ? 'Disable' : 'Enable'}
          </button>
        </hstack>
      </vstack>

      <vstack gap="small" padding="small" backgroundColor="#1a1a2e" cornerRadius="small">
        <text size="xsmall" color="#a0a0ff" weight="bold">QUEUE STATUS</text>
        <text size="small">{itemCount} items in queue</text>
        <button size="small" appearance="secondary" onPress={onRefreshQueue}>
          Refresh Queue ↻
        </button>
      </vstack>
    </vstack>
  );
}
