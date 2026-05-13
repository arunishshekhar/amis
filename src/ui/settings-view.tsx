import { Devvit } from '@devvit/public-api';

interface SettingsViewProps {
  aiProvider: string;
  aiConfigPresent: boolean;
  fullscreenEnabled: boolean;
  itemCount: number;
  onBack: () => void;
  onRefreshQueue: () => void | Promise<void>;
  onOpenAIConfig: () => void | Promise<void>;
  onToggleFullscreen: () => void | Promise<void>;
}

export function SettingsView({
  aiProvider,
  aiConfigPresent,
  fullscreenEnabled,
  itemCount,
  onBack,
  onRefreshQueue,
  onOpenAIConfig,
  onToggleFullscreen,
}: SettingsViewProps): JSX.Element {
  return (
    <vstack padding="medium" gap="medium" grow backgroundColor="#09090bFF">
      <hstack gap="small" alignment="start middle">
        <button appearance="plain" size="small" onPress={onBack}>← Back</button>
        <text weight="bold" size="medium" color="#e4e4e7FF">Settings</text>
      </hstack>

      <vstack gap="small" padding="small" backgroundColor="#18181bFF" cornerRadius="small">
        <text size="xsmall" color="#818cf8FF" weight="bold">AI CONFIGURATION</text>
        <text size="small" color="#e4e4e7FF">{aiProvider}</text>
        <text size="xsmall" color="#71717aFF" wrap>
          {aiConfigPresent ? 'Using KV-backed AI config' : 'Using app-level settings'}
        </text>
        <button size="small" appearance="secondary" onPress={onOpenAIConfig}>
          Edit AI config
        </button>
      </vstack>

      <vstack gap="small" padding="small" backgroundColor="#18181bFF" cornerRadius="small">
        <text size="xsmall" color="#818cf8FF" weight="bold">FULL SCREEN LAYOUT</text>
        <text size="xsmall" color="#71717aFF" wrap>
          Show a wider side-panel layout inside the post card.
        </text>
        <hstack alignment="start middle" gap="small">
          <text size="small" weight="bold" color="#e4e4e7FF">{fullscreenEnabled ? 'ON' : 'OFF'}</text>
          <button
            size="small"
            appearance={fullscreenEnabled ? 'destructive' : 'secondary'}
            onPress={onToggleFullscreen}
          >
            {fullscreenEnabled ? 'Disable' : 'Enable'}
          </button>
        </hstack>
      </vstack>

      <vstack gap="small" padding="small" backgroundColor="#18181bFF" cornerRadius="small">
        <text size="xsmall" color="#818cf8FF" weight="bold">QUEUE STATUS</text>
        <text size="small" color="#e4e4e7FF">{String(itemCount)} item{itemCount !== 1 ? 's' : ''} pending review</text>
        <text size="xsmall" color="#71717aFF" wrap>
          Dashboard auto-refreshes every 15s. Actions (Remove/Approve) are executed immediately on Reddit.
        </text>
        <button size="small" appearance="secondary" onPress={onRefreshQueue}>
          Run AI Analysis ↻
        </button>
      </vstack>
    </vstack>
  );
}
