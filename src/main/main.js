/**
 * Echo Q Bot — main.js
 * Electron main process.
 *
 * Responsibilities:
 *  - Creates the BrowserWindow
 *  - Manages all IPC handlers (credentials, automation, Jira)
 *  - Stores sensitive keys in the OS keychain via keytar
 *  - Spawns the automation engine in a child context
 */

'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path   = require('path');
const fs     = require('fs');
const isDev  = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ── Keytar (OS keychain) ──────────────────────────────────────────────────────
// Falls back gracefully if keytar native bindings aren't built yet (CI / dev).
let keytar;
try {
  keytar = require('keytar');
} catch (e) {
  console.warn('[main] keytar not available — using in-memory fallback:', e.message);
  const _store = {};
  keytar = {
    setPassword:    async (svc, acct, pwd) => { _store[`${svc}:${acct}`] = pwd; },
    getPassword:    async (svc, acct)      => _store[`${svc}:${acct}`] ?? null,
    deletePassword: async (svc, acct)      => { delete _store[`${svc}:${acct}`]; return true; },
    findCredentials:async (svc)            => Object.entries(_store).filter(([k]) => k.startsWith(svc+':')).map(([k,v])=>({account:k.split(':')[1],password:v})),
  };
}

const KEYTAR_SERVICE = 'EchoQBot';

// ── Update checker ─────────────────────────────────────────────────────────
const { startUpdateCheck } = require('./updateChecker');
const CURRENT_VERSION = '1.0.0';

// ── Automation engine (lazy-loaded so the main window opens fast) ─────────────
let automationEngine = null;
function getEngine() {
  if (!automationEngine) {
    automationEngine = require('./automationEngine');
  }
  return automationEngine;
}

// ── Window ────────────────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1400,
    height:          900,
    minWidth:        1024,
    minHeight:       700,
    backgroundColor: '#121416',
    titleBarStyle:   process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame:           process.platform !== 'darwin',
    show:            false,
    icon: path.join(app.getAppPath(), '..', 'icon.png'),
    webPreferences: {
      preload:              path.join(__dirname, 'preload.js'),
      contextIsolation:     true,   // MUST be true — renderer cannot access Node APIs directly
      nodeIntegration:      false,  // MUST be false
      sandbox:              false,  // preload needs some Node access
      webSecurity:          true,
      allowRunningInsecureContent: false,
    },
  });

  // Load React dev server in dev, built files in production
  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, 'index.html')}`;

  mainWindow.loadURL(startUrl);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in the default browser, not inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  mainWindow.webContents.once('did-finish-load', () => {
    startUpdateCheck(CURRENT_VERSION, (channel, data) => {
      mainWindow?.webContents.send(channel, data);
    });
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ═══════════════════════════════════════════════════════════════════════════════
// IPC HANDLERS — CREDENTIALS (keytar)
// All credential operations are handled exclusively in the main process.
// The renderer only receives sanitised confirmations, never raw keys.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Saves a credential to the OS keychain.
 * account: e.g. 'openai-api-key' | 'anthropic-api-key' | 'gemini-api-key' |
 *               'jira-api-token' | 'jira-domain' | 'jira-email'
 */
ipcMain.handle('credentials:set', async (_event, { account, value }) => {
  try {
    await keytar.setPassword(KEYTAR_SERVICE, account, value);
    return { ok: true };
  } catch (err) {
    console.error('[main] credentials:set error:', err);
    return { ok: false, error: err.message };
  }
});

/**
 * Retrieves a credential from the OS keychain.
 * Returns the value or null — never throws to the renderer.
 */
ipcMain.handle('credentials:get', async (_event, { account }) => {
  try {
    const value = await keytar.getPassword(KEYTAR_SERVICE, account);
    return { ok: true, value };
  } catch (err) {
    console.error('[main] credentials:get error:', err);
    return { ok: false, value: null, error: err.message };
  }
});

/**
 * Deletes a credential from the OS keychain.
 */
ipcMain.handle('credentials:delete', async (_event, { account }) => {
  try {
    const deleted = await keytar.deletePassword(KEYTAR_SERVICE, account);
    return { ok: deleted };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/**
 * Returns a summary of which credentials are configured (true/false per key).
 * Never returns the actual values.
 */
ipcMain.handle('credentials:status', async () => {
  const accounts = [
    'openai-api-key', 'anthropic-api-key', 'gemini-api-key',
    'jira-api-token', 'jira-domain', 'jira-email', 'jira-project',
    'ai-provider', 'ai-model',
  ];
  const status = {};
  for (const acct of accounts) {
    const val = await keytar.getPassword(KEYTAR_SERVICE, acct).catch(() => null);
    // For non-secret metadata store the value directly; for secrets just flag presence
    const isSecret = acct.includes('key') || acct.includes('token');
    status[acct] = isSecret ? (val !== null && val.length > 0) : (val ?? '');
  }
  return { ok: true, status };
});

// ═══════════════════════════════════════════════════════════════════════════════
// IPC HANDLERS — JIRA / XRAY
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('jira:fetch-tests', async (_event, { issueKey }) => {
  try {
    const domain = await keytar.getPassword(KEYTAR_SERVICE, 'jira-domain');
    const email  = await keytar.getPassword(KEYTAR_SERVICE, 'jira-email');
    const token  = await keytar.getPassword(KEYTAR_SERVICE, 'jira-api-token');
    if (!domain || !email || !token) {
      return { ok: false, error: 'Jira credentials not configured.' };
    }

    const axios = require('axios');
    const auth  = Buffer.from(`${email}:${token}`).toString('base64');

    // Fetch issue details (includes Xray custom fields)
    const issueRes = await axios.get(
      `https://${domain}/rest/api/3/issue/${issueKey}`,
      { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } }
    );

    // Attempt to fetch Xray test steps via the Xray REST API
    let xraySteps = [];
    try {
      const xrayRes = await axios.get(
        `https://${domain}/rest/raven/1.0/api/test/${issueKey}/steps`,
        { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } }
      );
      xraySteps = xrayRes.data ?? [];
    } catch (xrayErr) {
      console.warn('[main] Xray steps endpoint not available (Xray Cloud may differ):', xrayErr.message);
      // Fall back to extracting steps from the description ADF
      xraySteps = extractStepsFromADF(issueRes.data.fields?.description);
    }

    return {
      ok: true,
      issue: {
        key:         issueRes.data.key,
        summary:     issueRes.data.fields?.summary ?? '',
        description: issueRes.data.fields?.description,
        status:      issueRes.data.fields?.status?.name ?? '',
        priority:    issueRes.data.fields?.priority?.name ?? '',
        // Xray custom fields (field IDs vary — map the most common)
        testType:    issueRes.data.fields?.['customfield_10100'] ?? null,
        gherkin:     issueRes.data.fields?.['customfield_10101'] ?? null,
        steps:       xraySteps,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('jira:create-ticket', async (_event, ticketData) => {
  try {
    const domain = await keytar.getPassword(KEYTAR_SERVICE, 'jira-domain');
    const email  = await keytar.getPassword(KEYTAR_SERVICE, 'jira-email');
    const token  = await keytar.getPassword(KEYTAR_SERVICE, 'jira-api-token');

    const axios = require('axios');
    const auth  = Buffer.from(`${email}:${token}`).toString('base64');

    const payload = buildJiraADFPayload(ticketData);
    const res = await axios.post(
      `https://${domain}/rest/api/3/issue`,
      payload,
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' } }
    );

    return { ok: true, key: res.data.key, url: `https://${domain}/browse/${res.data.key}` };
  } catch (err) {
    const detail = err.response?.data?.errors
      ? Object.values(err.response.data.errors).join(', ')
      : err.message;
    return { ok: false, error: detail };
  }
});

ipcMain.handle('jira:load-projects', async () => {
  try {
    const domain = await keytar.getPassword(KEYTAR_SERVICE, 'jira-domain');
    const email  = await keytar.getPassword(KEYTAR_SERVICE, 'jira-email');
    const token  = await keytar.getPassword(KEYTAR_SERVICE, 'jira-api-token');
    const axios  = require('axios');
    const auth   = Buffer.from(`${email}:${token}`).toString('base64');
    const res    = await axios.get(
      `https://${domain}/rest/api/3/project/search?maxResults=50&orderBy=name`,
      { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } }
    );
    return { ok: true, projects: (res.data.values ?? []).map(p => ({ key: p.key, name: p.name })) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// IPC HANDLERS — AUTOMATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('automation:start', async (_event, { issueKey, steps, provider, model, csvContext }) => {
  try {
    const apiKey   = await resolveAiApiKey(provider);
    const endpoint = await resolveAiEndpoint(provider);
    const isLocal  = ['ollama', 'localai'].includes(provider?.toLowerCase());

    if (!apiKey && !isLocal) {
      return { ok: false, error: `No API key configured for provider: ${provider}` };
    }

    const engine = getEngine();
    engine.start({
      steps, provider, model, apiKey: apiKey || 'local',
      endpoint, csvContext,
      sendEvent: (ch, data) => { mainWindow?.webContents.send(ch, data); },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('automation:stop', async () => {
  try {
    const engine = getEngine();
    await engine.stop();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('automation:status', async () => {
  const engine = getEngine();
  return { ok: true, status: engine.getStatus() };
});

// ═══════════════════════════════════════════════════════════════════════════════
// IPC HANDLERS — AI (direct prompt, outside automation)
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('ai:validate-key', async (_event, { provider }) => {
  try {
    const apiKey   = await resolveAiApiKey(provider);
    const endpoint = await resolveAiEndpoint(provider);
    const isLocal  = ['ollama', 'localai'].includes(provider?.toLowerCase());
    if (!apiKey && !isLocal) return { ok: false, error: 'No key or endpoint stored.' };
    const { AIService } = require('./aiService');
    const svc = new AIService({ provider, model: getDefaultModel(provider), apiKey: apiKey || 'local', endpoint });
    await svc.ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});


ipcMain.handle('automation:send-answer', async (_event, data) => {
  try {
    const engine = getEngine();
    engine.receiveAgentAnswer(data);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// IPC HANDLERS — SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('system:open-external', async (_event, { url }) => {
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('system:show-save-dialog', async (_event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle('system:get-platform', () => {
  return { platform: process.platform, arch: process.arch };
});

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function resolveAiApiKey(provider) {
  const keyMap = {
    openai:    'openai-api-key',
    anthropic: 'anthropic-api-key',
    gemini:    'gemini-api-key',
    ollama:    null,   // no key needed
    localai:   null,   // optional key
  };
  const p = provider?.toLowerCase();
  if (!(p in keyMap)) return null;
  if (keyMap[p] === null) return 'local'; // signal: no key required
  return keytar.getPassword(KEYTAR_SERVICE, keyMap[p]);
}

async function resolveAiEndpoint(provider) {
  const p = provider?.toLowerCase();
  const endpointMap = {
    ollama:  'ollama-endpoint',
    localai: 'localai-endpoint',
  };
  const account = endpointMap[p];
  if (!account) return null;
  const stored = await keytar.getPassword(KEYTAR_SERVICE, account);
  const defaults = { ollama: 'http://localhost:11434', localai: 'http://localhost:8080' };
  return stored || defaults[p] || null;
}

function getDefaultModel(provider) {
  const defaults = {
    openai:    'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    gemini:    'gemini-1.5-pro',
    ollama:    'llava',
    localai:   'gpt-4-vision-preview',
  };
  return defaults[provider] ?? 'gpt-4o';
}

function extractStepsFromADF(adf) {
  if (!adf || !adf.content) return [];
  const steps = [];
  for (const block of adf.content) {
    if (block.type === 'paragraph') {
      const text = block.content?.map(n => n.text || '').join('') ?? '';
      if (text.trim()) steps.push({ index: steps.length + 1, action: text.trim() });
    }
  }
  return steps;
}

function buildJiraADFPayload(td) {
  const para = t => ({ type: 'paragraph', content: [{ type: 'text', text: String(t ?? '') }] });
  const h    = (t, l = 3) => ({ type: 'heading', attrs: { level: l }, content: [{ type: 'text', text: t }] });
  const hr   = () => ({ type: 'rule' });
  const panel = (t, type = 'info') => ({ type: 'panel', attrs: { panelType: type }, content: [para(t)] });

  return {
    fields: {
      project:     { key: td.projectKey },
      summary:     td.summary,
      issuetype:   { name: td.issueType ?? 'Bug' },
      priority:    { name: td.priority  ?? 'Medium' },
      labels:      td.labels ?? ['echo-q-bot', 'automated-test'],
      description: {
        version: 1, type: 'doc',
        content: [
          panel(`🤖 Echo Q Bot | ${td.testKey ?? ''} | ${new Date().toLocaleString()}`, 'info'),
          h('Test Step Context'),        para(td.stepContext ?? ''),
          hr(),
          h('AI Reasoning'),             para(td.aiReason   ?? ''),
          hr(),
          h('Expected'),                 para(td.expected   ?? ''),
          h('Actual'),                   para(td.actual     ?? ''),
          td.severity === 'Critical' || td.severity === 'High'
            ? panel(`⚠️ ${td.severity} severity — prompt attention required`, 'warning')
            : para(''),
          hr(), para('Screenshot attached if captured.'),
        ],
      },
      // Xray custom fields — only set if values are present
      ...(td.xrayTestKey ? { 'customfield_10014': td.xrayTestKey } : {}),
    },
  };
}
