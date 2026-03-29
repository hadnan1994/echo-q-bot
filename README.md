# Echo Q Bot

AI-powered QA automation desktop application — migrated from the HB Bot Chrome extension.

Built with Electron + Playwright + React. Supports OpenAI, Anthropic (Claude), and Google Gemini as LLM providers.

---

## Architecture

```
echo-q-bot/
├── src/
│   ├── main/
│   │   ├── main.js              ← Electron main process, IPC handlers, keytar
│   │   ├── preload.js           ← Secure contextBridge API surface
│   │   ├── aiService.js         ← Provider-agnostic LLM layer (OpenAI / Anthropic / Gemini)
│   │   └── automationEngine.js  ← Playwright agentic loop
│   └── renderer/
│       ├── components/
│       │   └── Settings.jsx     ← React settings UI (Command Horizon design)
│       └── screens/             ← Dashboard, ActiveAutomation, LiveSession screens
├── assets/
│   ├── icon.png / icon.ico / icon.icns
│   └── entitlements.mac.plist
└── package.json
```

### Security Model

```
Renderer (React)
    │ window.echoQBot.*  (contextBridge — typed, whitelist-only)
    ▼
preload.js
    │ ipcRenderer.invoke()  (whitelisted channels only)
    ▼
main.js  (Node.js — full privileges)
    │ keytar.setPassword / getPassword
    ▼
OS Keychain
  Windows: Credential Manager
  macOS:   Keychain Access
```

**No raw API keys ever reach the renderer.** The renderer only sees boolean flags (key configured: true/false) and non-sensitive metadata.

---

## Agentic Automation Flow

```
Xray test step (Gherkin text)
       │
       ▼
automationEngine.js
  1. capturePageState() → screenshot (JPEG base64) + DOM snapshot
  2. ai.analyzeAndAct() → sends to LLM with step + history
  3. LLM returns structured JSON: { action, reasoning, confidence, stepComplete }
  4. performAction() → Playwright click / fill / navigate / assert
  5. If not stepComplete → loop back to 1 (max 4 retries)
  6. Emit events to renderer: step-update, log, screenshot, failure-detected
       │
       ▼
Renderer receives events via IPC push channels
  - Live screenshot preview
  - Real-time AI reasoning log
  - Step pass/fail status
  - One-click Jira ticket creation on failure
```

---

## Setup

### Prerequisites

- Node.js 18+
- npm 9+
- Windows 10+ or macOS 12+

### Install

```bash
git clone https://github.com/your-org/echo-q-bot
cd echo-q-bot
npm install

# Install Playwright browser binaries
npx playwright install chromium
```

### Development

```bash
npm run dev
# Starts React dev server (port 3000) + Electron simultaneously
```

### Production build

```bash
# Both platforms
npm run build:all

# Windows only (.exe NSIS installer)
npm run build:win

# macOS only (.dmg, x64 + arm64)
npm run build:mac
```

Outputs go to `dist/`.

---

## keytar — OS Keychain

All sensitive values are stored via [keytar](https://github.com/atom/node-keytar).

| Account key          | What's stored                          |
|----------------------|----------------------------------------|
| `openai-api-key`     | OpenAI API key (sk-...)                |
| `anthropic-api-key`  | Anthropic API key (sk-ant-...)         |
| `gemini-api-key`     | Google Gemini API key (AIza...)        |
| `jira-api-token`     | Jira API token                         |
| `jira-domain`        | yourco.atlassian.net                   |
| `jira-email`         | user@company.com                       |
| `jira-project`       | Default project key (e.g. QA)          |
| `ai-provider`        | Active provider: openai / anthropic / gemini |
| `ai-model`           | Active model string                    |

On macOS these appear in **Keychain Access** under the service name `EchoQBot`.
On Windows they appear in **Credential Manager** → Windows Credentials.

### keytar native build

keytar is a native Node addon. If it fails to build:

```bash
# Windows — requires Visual Studio Build Tools
npm install --global windows-build-tools

# macOS — requires Xcode CLI tools
xcode-select --install

# Then rebuild
npm rebuild keytar
```

---

## IPC Channel Reference

### Renderer → Main (invoke)

| Channel                  | Payload                              | Returns                         |
|--------------------------|--------------------------------------|---------------------------------|
| `credentials:set`        | `{ account, value }`                 | `{ ok }`                        |
| `credentials:get`        | `{ account }`                        | `{ ok, value }`                 |
| `credentials:delete`     | `{ account }`                        | `{ ok }`                        |
| `credentials:status`     | —                                    | `{ ok, status: {...} }`         |
| `jira:fetch-tests`       | `{ issueKey }`                       | `{ ok, issue: {...} }`          |
| `jira:create-ticket`     | ticket data object                   | `{ ok, key, url }`              |
| `jira:load-projects`     | —                                    | `{ ok, projects: [...] }`       |
| `automation:start`       | `{ steps, provider, model }`         | `{ ok }`                        |
| `automation:stop`        | —                                    | `{ ok }`                        |
| `automation:status`      | —                                    | `{ ok, status }`                |
| `ai:validate-key`        | `{ provider }`                       | `{ ok }`                        |

### Main → Renderer (push events)

| Channel                      | Data                                          |
|------------------------------|-----------------------------------------------|
| `automation:step-update`     | `{ stepIndex, status, message, screenshot }`  |
| `automation:log`             | `{ level, message, timestamp }`               |
| `automation:complete`        | `{ total, passed, failed, timestamp }`        |
| `automation:error`           | `{ message }`                                 |
| `automation:screenshot`      | `{ dataUrl }`                                 |
| `automation:failure-detected`| `{ stepIndex, stepText, expected, actual, screenshot, aiReasoning }` |

---

## Xray Integration

Echo Q Bot fetches test steps via two endpoints (tried in order):

1. **Xray Server API:** `GET /rest/raven/1.0/api/test/{issueKey}/steps`
2. **Fallback:** Parses steps from the issue's ADF description body

Custom Xray fields mapped:
- `customfield_10100` → Test Type
- `customfield_10101` → Gherkin/BDD scenario text

> **Note:** Xray Cloud uses a different GraphQL API. Extend `main.js` → `jira:fetch-tests` handler with the Xray Cloud GraphQL endpoint if needed.

---

## macOS Notarization

For distribution outside the App Store, add your Apple credentials to the build:

```bash
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
npm run build:mac
```

The `entitlements.mac.plist` must include `com.apple.security.cs.allow-unsigned-executable-memory` for Playwright's browser processes.

---

## Design System

The UI implements the **"Command Horizon"** design spec (`echo_midnight/DESIGN.md`):

- Deep oceanic dark surfaces (`#121416` base)
- Hyper-Amber `#ffba38` accents for CTAs and active states
- No-line rule: section boundaries via background shifts only
- Glassmorphism AI insight panels (`backdrop-blur: 20px`)
- Manrope (headlines) + Inter (body) dual typeface
- 4px amber accent bar on active/failed test cards
