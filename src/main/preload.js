/**
 * Echo Q Bot — preload.js
 *
 * This script runs in a privileged context (has access to Node APIs) but
 * injects a safe, typed API surface into the renderer via contextBridge.
 *
 * Security model:
 *   - contextIsolation: true  → renderer JS cannot reach preload scope
 *   - nodeIntegration: false  → renderer has zero direct Node access
 *   - Only explicitly whitelisted channels can be invoked
 *   - Input validation happens here before IPC is forwarded to main
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── Whitelist of valid IPC channels ──────────────────────────────────────────
const INVOKE_CHANNELS = new Set([
  'credentials:set',
  'credentials:get',
  'credentials:delete',
  'credentials:status',
  'jira:fetch-tests',
  'jira:create-ticket',
  'jira:load-projects',
  'automation:start',
  'automation:stop',
  'automation:status',
  'automation:send-answer',
  'ai:validate-key',
  'system:open-external',
  'system:show-save-dialog',
  'system:get-platform',
]);

// Channels main process pushes to renderer (listen-only in renderer)
const LISTEN_CHANNELS = new Set([
  'automation:step-update',        // { stepIndex, status, message, screenshot }
  'automation:log',                // { level, message, timestamp }
  'automation:complete',           // { passed, failed, summary }
  'automation:error',              // { message }
  'automation:screenshot',         // { dataUrl, stepIndex }
  'automation:failure-detected',   // { stepIndex, stepText, expected, actual, aiReasoning }
  'automation:agent-question',     // { question }
  'update:available',              // { currentVersion, newVersion, downloadUrl, releaseNotes }
]);

// ── Safe invoke wrapper ───────────────────────────────────────────────────────
function safeInvoke(channel, payload) {
  if (!INVOKE_CHANNELS.has(channel)) {
    throw new Error(`[preload] Blocked: '${channel}' is not a whitelisted IPC channel.`);
  }
  return ipcRenderer.invoke(channel, payload);
}

// ── Safe event listener wrapper ───────────────────────────────────────────────
function safeOn(channel, callback) {
  if (!LISTEN_CHANNELS.has(channel)) {
    throw new Error(`[preload] Blocked: '${channel}' is not a whitelisted listen channel.`);
  }
  // Wrap to strip the Electron Event object before passing data to renderer
  const handler = (_event, data) => callback(data);
  ipcRenderer.on(channel, handler);
  // Return unsubscribe function
  return () => ipcRenderer.removeListener(channel, handler);
}

// ── Expose the EchoQBot API to the renderer ───────────────────────────────────
contextBridge.exposeInMainWorld('echoQBot', {

  // ── Credentials (keytar / OS keychain) ──────────────────────────────────
  credentials: {
    /**
     * Store a credential in the OS keychain.
     * @param {string} account - e.g. 'openai-api-key'
     * @param {string} value   - the secret value
     */
    set: (account, value) => {
      if (typeof account !== 'string' || typeof value !== 'string') {
        throw new TypeError('credentials.set: account and value must be strings');
      }
      return safeInvoke('credentials:set', { account, value });
    },

    /**
     * Retrieve a credential. Returns { ok, value } where value may be null.
     */
    get: (account) => {
      if (typeof account !== 'string') throw new TypeError('credentials.get: account must be a string');
      return safeInvoke('credentials:get', { account });
    },

    /**
     * Delete a credential from the keychain.
     */
    delete: (account) => safeInvoke('credentials:delete', { account }),

    /**
     * Returns a status object: { 'openai-api-key': true, 'jira-domain': 'myco.atlassian.net', ... }
     * Secrets return a boolean (configured: true/false), not the actual values.
     */
    status: () => safeInvoke('credentials:status', undefined),
  },

  // ── Jira / Xray ─────────────────────────────────────────────────────────
  jira: {
    /** Fetch test issue details + Xray steps by issue key */
    fetchTests:    (issueKey) => safeInvoke('jira:fetch-tests',   { issueKey }),
    /** Create a Jira bug ticket with ADF description */
    createTicket:  (ticketData)=> safeInvoke('jira:create-ticket', ticketData),
    /** Load all Jira projects the user has access to */
    loadProjects:  ()          => safeInvoke('jira:load-projects', undefined),
  },

  // ── Automation engine ────────────────────────────────────────────────────
  automation: {
    /**
     * Start a test run.
     * @param {object} opts - { issueKey, steps, provider, model }
     */
    start:  (opts)  => safeInvoke('automation:start',  opts),
    /** Stop a running automation session */
    stop:   ()      => safeInvoke('automation:stop',   undefined),
    /** Get current automation status */
    status:     ()      => safeInvoke('automation:status', undefined),
    sendAnswer: (data)  => safeInvoke('automation:send-answer', data),
  },

  // ── AI ───────────────────────────────────────────────────────────────────
  ai: {
    /** Validate that the stored key for a provider is working */
    validateKey: (provider) => safeInvoke('ai:validate-key', { provider }),
  },

  // ── System ───────────────────────────────────────────────────────────────
  system: {
    openExternal: (arg) => safeInvoke('system:open-external', typeof arg === 'string' ? { url: arg } : arg),
    showSaveDialog: (options) => safeInvoke('system:show-save-dialog',  options),
    getPlatform:    ()        => safeInvoke('system:get-platform',      undefined),
  },

  // ── Event bus (main → renderer, push only) ───────────────────────────────
  on:  (channel, callback) => safeOn(channel, callback),
  off: (channel, callback) => ipcRenderer.removeListener(channel, callback),
});
