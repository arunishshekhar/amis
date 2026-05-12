import { Devvit } from '@devvit/public-api';

export function makeDashboardPreview(): JSX.Element {
  return (
    <vstack alignment="center middle" grow>
      <text size="large">⚡ AMIS Dashboard</text>
      <text color="#888888">Loading...</text>
    </vstack>
  );
}
