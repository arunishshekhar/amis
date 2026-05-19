# AMIS - AI Moderation Intelligence Dashboard

AMIS is a Reddit moderation app for moderators. It checks subreddit posts against your own rules, explains likely violations, and gives your mod team a dashboard for triage, history, and consistency insights.

AMIS is not a replacement for moderators. It provides rule-aware recommendations and can optionally take automatic actions when confidence is high.

## What AMIS Does

- Checks new posts against subreddit rules, Automoderator config, selected wiki pages, and removal reasons.
- Reprocesses posts when they are edited.
- Checks both post title and body.
- Flags likely violations with confidence, matched rule, and rationale.
- Detects near-duplicate posts.
- Shows a moderator dashboard inside Reddit.
- Supports manual Remove, Approve, and Escalate actions.
- Can auto-remove or auto-approve when enabled in app settings.
- Adds removal notes and a visible distinguished removal comment when AMIS removes a post.
- Keeps a history of AMIS and moderator actions.
- Provides consistency insights after enough moderation history is available.

## Important Limitation

AMIS cannot block Reddit's native post composer before a user submits.

Devvit apps receive `onPostSubmit` and `onPostUpdate` events after Reddit has created or edited the post. AMIS verifies posts immediately after submission or edit, then removes, comments, messages, or records recommendations if needed.

For hard pre-submit prevention, use native subreddit rules and Automoderator where possible.

## Moderator Setup

### 1. Install the App

Install AMIS from the Reddit App Directory on the subreddit where you moderate.

After install, open your subreddit and use:

`Mod Tools -> AMIS: Open Dashboard`

If the dashboard post is missing or broken, run:

`Mod Tools -> AMIS: Repair Dashboard Post`

### 2. Add an AI Key

Open the AMIS dashboard and go to **Settings**.

Choose a provider:

- `openai`
- `gemini`
- `claude`

Paste the provider API key and save.

If a key is already present, AMIS shows that a key exists. The key value is never shown again. Entering a new key overrides the old dashboard-stored key. Leaving the field blank keeps the existing key.

For Claude embeddings, add a Voyage API key as well.

### Where Keys Are Stored

AMIS stores dashboard-entered keys in Devvit KV storage for the installed subreddit/app context. Keys are stored server-side and are not sent back to the browser. The dashboard only receives status like "key configured".

If an app-level secret is configured by the app owner, that secret is preferred over a dashboard key.

### 3. Refresh Policy

Run:

`Mod Tools -> AMIS: Refresh Policy`

Do this after install and whenever you change:

- Subreddit rules
- Rule descriptions
- Automoderator config
- Relevant wiki pages
- Removal reasons

AMIS uses the rule title, description, and violation/removal text when evaluating posts.

## Daily Moderator Workflow

1. Open the AMIS dashboard.
2. Check **Triage** for posts needing review.
3. Use **Remove**, **Approve**, or **Escalate**.
4. Check **History** to see removed, approved, escalated, and AI-approved items.
5. Use filters and pagination in History when the list grows.
6. Run **Refresh Policy** after any rule changes.
7. Run **Consistency Check** occasionally once the subreddit has enough moderation history.

## Dashboard Views

### Triage

Shows posts AMIS thinks need moderator attention.

Each item includes:

- Post title and body
- Author
- Suggested action
- Risk level
- Confidence
- Matched rule
- Rationale
- Reports, if available

Available actions:

- **Remove** - removes the post, records the decision, adds a removal note, and posts a distinguished removal comment.
- **Approve** - approves the post and records the decision.
- **Escalate** - records the post for moderator follow-up.

### History

Shows past AMIS and moderator actions.

Filters include:

- All
- AI-approved
- Removed
- Approved by mod
- Escalated

History is paginated so the dashboard remains usable inside Reddit's app view.

### Insights

Shows consistency analytics when enough moderation decisions exist. These are operational signals for moderators, not judgments about individual moderators.

### Settings

Configure:

- AI provider
- Provider API key
- Voyage API key, if needed

Existing keys are never displayed. Saving a new key replaces the previous dashboard-stored key.

## Automatic Moderation

AMIS can automatically remove or approve posts when auto-actions are enabled.

App settings:

- `AUTO_ACT_ENABLED` - enables automatic moderation actions.
- `AUTO_REMOVE_THRESHOLD` - minimum confidence for automatic removal. Default is `90`.

When AMIS removes a post automatically, it:

1. Removes the post.
2. Adds a Reddit removal note.
3. Posts a visible distinguished removal comment.
4. Saves the action to AMIS history.

Use auto-actions carefully. Dashboard actions and auto-actions call Reddit's real moderation APIs.

## Mod Tools Menu

| Menu Item | Use It For |
|---|---|
| `AMIS: Open Dashboard` | Open or create the dashboard post |
| `AMIS: Repair Dashboard Post` | Create a fresh dashboard post if the old one is broken |
| `AMIS: Analyze Queue` | Run analysis on the current moderation queue |
| `AMIS: Refresh Policy` | Re-sync rules, Automod, wiki pages, and removal reasons |
| `AMIS: Health Check` | Check whether AMIS has items, embeddings, and insights |
| `AMIS: Consistency Check` | Run consistency analysis on recent decisions |

AI-heavy menu actions run in the background. Reddit may show a toast immediately while the job completes shortly after.

## What AMIS Checks

AMIS evaluates posts against:

- Subreddit rules and descriptions
- Rule violation reason text
- Automoderator YAML
- Configured wiki pages
- Existing removal reasons
- Near-duplicate content

For structural rules, AMIS checks the relevant field directly:

- title rules check the title
- body/description rules check the body
- generic post rules check both title and body

For factual rules, AMIS asks the AI to reason about whether the claim is true or false. AMIS also has deterministic checks for common obvious falsehoods used in testing, such as `2 + 2 = 5`.

## Troubleshooting

### Posts Are Not Being Analysed

Check:

- The app is installed on the subreddit.
- A provider API key is configured in Settings.
- `AMIS: Refresh Policy` has been run.
- The latest app version has been uploaded/deployed.
- Devvit playtest or production logs do not show provider/API errors.

### Rules Are Missing or Wrong

Run:

`AMIS: Refresh Policy`

Then test again with a new post or edit an existing post to trigger reprocessing.

### A Key Was Saved but Is Not Visible

This is expected. AMIS never displays saved secret values. It only shows whether a key is configured. Enter a new key to replace the old one.

### A Removed Post Did Not Get the Expected Comment

AMIS uses Reddit APIs to remove the post, add a removal note, and create a distinguished removal comment. If the public comment does not appear, check app permissions, moderator status, and Devvit logs for `failed to add distinguished removal comment`.

### Can AMIS Stop a Bad Post Before It Is Submitted?

No. Reddit's native composer does not expose a Devvit pre-submit blocking hook. AMIS checks immediately after submission or edit.

For hard pre-submit prevention, use native subreddit rules and Automoderator where possible.

## For Developers

Common commands:

```bash
npm install
npm test
npm run build
devvit playtest r/yoursubreddit
devvit upload
```

Core files:

- `devvit.json` - app configuration, triggers, menu items, scheduler
- `src/server/index.ts` - API routes, trigger endpoints, menu endpoints
- `src/triggers/post-submit.ts` - new/edit post analysis pipeline
- `src/policy/llm-classifier.ts` - AI rule classification
- `src/policy/structural-validator.ts` - deterministic rule cross-checks
- `src/shared/moderation-comments.ts` - removal notes, moderator comments, author messages
- `src/client/index.html` and `src/client/main.js` - dashboard UI

## Safety Notes

- Remove and approve actions are real Reddit moderation actions.
- AMIS history is kept as a moderation audit trail.
- API keys are stored server-side and are not returned to the dashboard.
- Human moderators should review AMIS recommendations before enabling automatic actions.
