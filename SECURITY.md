# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅ Yes    |

## Reporting a Vulnerability

If you discover a security vulnerability in Echo Q Bot, please **do not open a public GitHub issue**.

Instead, report it privately by emailing:

**support@echoqbot.com**

Please include:
- A description of the vulnerability
- Steps to reproduce it
- The version of Echo Q Bot affected
- Your operating system and version
- Any relevant screenshots or logs

## What to Expect

- **Acknowledgement** within 3–5 business days
- **Status update** within 14 days
- **Fix or mitigation** as soon as reasonably possible depending on severity

We take security seriously. Valid reports will be credited in the release notes
unless you prefer to remain anonymous.

## Scope

The following are in scope:

- Credential storage and keytar integration
- IPC communication between renderer and main process
- Playwright browser automation security
- AI provider API key handling
- Update checker (echoqbot.com/version.json)

The following are out of scope:

- Vulnerabilities in third-party dependencies (report those upstream)
- Issues requiring physical access to the machine
- Social engineering attacks

## Security Model

Echo Q Bot stores all API keys and tokens exclusively in the OS keychain
(Windows Credential Manager / macOS Keychain) via the `keytar` library.
Keys are never written to disk, logged, or transmitted anywhere except
directly to the AI provider you configure.

The Electron app uses:
- `contextIsolation: true`
- `nodeIntegration: false`
- A strict IPC channel whitelist in `preload.js`

Thank you for helping keep Echo Q Bot secure.
