# red-alert-slack

Local macOS service that listens for Israeli Red Alert / Tzofar events and updates your Slack custom status while a matching alert is active.

## What is implemented

- Node.js 20+ TypeScript service
- Live Tzofar websocket client using the Android transport: `wss://ws.tzevaadom.co.il/socket?platform=ANDROID`
- Parser that handles both current Tzofar websocket envelopes and Oref-style payloads used by the existing Home Assistant implementation
- Configurable area matching with the same name normalization approach used by the referenced Home Assistant code
- macOS `System Events` Slack UI automation
- Saved-state recovery across restarts
- Heartbeat-based websocket liveliness checks for sleep/wake recovery
- Duplicate suppression
- `launchd` LaunchAgent template
- Tests for parsing, dedupe, state persistence, and status restore behavior

## Important behavior note

I verified the current live Tzofar websocket URL and its `ALERT` envelope shape from the public site bundle, and then switched the runtime default to the Android transport because the Homebridge implementation shows that `SYSTEM_MESSAGE` traffic there includes early-warning and exit-notification classes.

I did not find a verified public all-clear websocket payload shape. Because of that, the service restores your previous Slack status in two ways:

1. Immediately if it sees a message that matches explicit end phrases such as `חזרה לשגרה`
2. Otherwise when the configured Slack status TTL expires with no fresh matching alert

That is why `STATUS_EXPIRATION_SECONDS` is both the Slack failsafe and the local inactivity window.

## Quickstart

### 1. Requirements

- macOS
- Node.js 20 or newer
- Slack desktop app

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy `.env.example` to `.env` and fill in your values.

Minimal `.env` for the current default behavior:

```bash
ALERT_AREAS=קריית ביאליק
```

With only `ALERT_AREAS` set, the service now defaults to:

- `STATUS_TEXT=In shelter`
- `STATUS_EMOJI=:rotating_light:`
- `STATUS_EXPIRATION_SECONDS=1800`
- `ALERT_LOG_FILE=./alerts.log.jsonl`
- `SYSTEM_EVENTS_APP_NAME=Slack`
- `SYSTEM_EVENTS_STATUS_TARGET=you`

Optional settings:

- `WS_URL`: override websocket URL
- `STATE_FILE`: override the local JSON state path
- `LOG_LEVEL`: `info` or `debug`
- `CONFIG_FILE`: optional JSON config file path
- `OBSERVE_ONLY`: if `true`, run without Slack writes and log matching events only
- `ALERT_LOG_FILE`: JSONL file for matching events in observe-only mode or normal mode
- `SYSTEM_EVENTS_APP_NAME`: app name for UI automation, usually `Slack`
- `SYSTEM_EVENTS_STATUS_TARGET`: optional Slack switcher target for UI mode, defaults to `you`
- `SYSTEM_EVENTS_RESTORE_TEXT`: optional status text to restore when using `system-events`
- `SYSTEM_EVENTS_RESTORE_EMOJI`: optional emoji to restore when using `system-events`

### 4. Prime permissions

Before starting the service, trigger Slack/macOS permission prompts once:

```bash
npm run test-status
```

That one-shot mode sets Slack status to `test status` and exits. The same mode is also available as:

```bash
npm start -- --test
```

### 5. Run locally

For a production-style run:

```bash
npm run build
npm start
```

For local development:

```bash
npm run dev
```

To capture live alerts without Slack status changes:

```bash
OBSERVE_ONLY=true ALERT_LOG_FILE=./alerts.log.jsonl npm run dev
```

If you have not chosen areas yet, omit `ALERT_AREAS` in observe-only mode and the service will log all non-ignored alert events.

### 6. Verify behavior

On startup you should see:

- a websocket connection log line
- matching alerts only for your configured areas

When a matching alert arrives:

- the service sends the configured `/status` command through Slack UI automation
- records the active alert window locally
- refreshes the alert TTL as new matching active events arrive

When the alert ends or the TTL expires:

- the service clears the Slack status, or restores the configured fallback restore text/emoji if you set them

## UI Automation

```bash
npm run dev
```

Notes:

- The process running the service needs macOS Accessibility permission so it can control Slack through `System Events`.
- The app uses Slack's channel switcher to jump to a known non-thread DM target, then sends the `/status` slash command there to set and clear the emergency status.
- By default it uses `you` as the switcher target, which resolved correctly on this machine. Override `SYSTEM_EVENTS_STATUS_TARGET` only if your Slack build needs a different target.
- Use `npm run test-status` once before running the service if you want macOS to prompt for the required Slack automation permissions ahead of the first real alert.
- The UI automation cannot reliably read your current Slack status first. If you want a non-empty restore target, set `SYSTEM_EVENTS_RESTORE_TEXT` and `SYSTEM_EVENTS_RESTORE_EMOJI`. Otherwise it will clear the status when the alert ends.
- The `/status` command path has been verified on this machine for both setting and clearing status. It still depends on Slack being frontmost and the switcher resolving the configured target to a normal DM.

## Optional JSON config

If you prefer JSON over env-only configuration, create `red-alert-slack.config.json` or `config.json` in the project root, or set `CONFIG_FILE`.

Example:

```json
{
  "ALERT_AREAS": ["תל אביב - מרכז העיר", "חיפה - מפרץ"],
  "STATUS_TEXT": "In shelter",
  "STATUS_EMOJI": ":rotating_light:",
  "STATUS_EXPIRATION_SECONDS": 1800
}
```

Environment variables override JSON values.

## Tests

```bash
npm test
```

## launchd setup

1. Install the LaunchAgent template:

```bash
npm run install-launchagent
```

2. Load it:

```bash
launchctl load ~/Library/LaunchAgents/local.red-alert-slack.plist
```

3. Restart after config changes:

```bash
npm run install-launchagent
launchctl unload ~/Library/LaunchAgents/local.red-alert-slack.plist
launchctl load ~/Library/LaunchAgents/local.red-alert-slack.plist
```

## Files

- Source: `src/`
- Tests: `test/`
- LaunchAgent template: `launchd/local.red-alert-slack.plist`
- Local persisted state: `state.json` by default

## References used

- Existing Home Assistant implementation: [idodov/RedAlert](https://github.com/idodov/RedAlert)
- Current Tzofar public web client: [tzevaadom.co.il](https://www.tzevaadom.co.il/)
