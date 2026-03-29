/**
 * Echo Q Bot — Settings.jsx
 *
 * Security Settings screen.
 * Implements the "Command Horizon" design spec:
 *   - Deep oceanic surface palette
 *   - Hyper-Amber (#ffba38) accents
 *   - No-line rule: boundaries via bg shifts
 *   - Glassmorphism AI insight panels
 *   - Manrope headlines / Inter body
 *
 * All credential writes go through window.echoQBot.credentials.set()
 * which IPC-bridges to keytar in the main process.
 * Raw values are never stored in React state after submission.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Design tokens (mirrors DESIGN.md) ────────────────────────────────────────
const T = {
  surface:          '#121416',
  surfaceDim:       '#121416',
  surfaceLow:       '#1a1c1e',
  surfaceContainer: '#1e2022',
  surfaceHigh:      '#282a2c',
  surfaceBright:    '#38393c',
  surfaceHighest:   '#333537',
  surfaceLowest:    '#0c0e10',
  primary:          '#a9c7ff',
  primaryContainer: '#004b95',
  onPrimary:        '#003063',
  tertiary:         '#ffba38',
  tertiaryContainer:'#674600',
  onTertiary:       '#432c00',
  secondary:        '#b4cad6',
  onSurface:        '#e2e2e5',
  onSurfaceVariant: '#c3c6d4',
  outline:          '#8d909d',
  outlineVariant:   '#434652',
  error:            '#ffb4ab',
  errorContainer:   '#93000a',
};

// ── Provider definitions ──────────────────────────────────────────────────────
const AI_PROVIDERS = [
  {
    id:      'openai',
    name:    'OpenAI',
    logo:    '◎',
    color:   '#10a37f',
    keyAcct: 'openai-api-key',
    keyHint: 'sk-...',
    models:  ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4'],
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id:      'anthropic',
    name:    'Anthropic',
    logo:    '◈',
    color:   '#cc9b7a',
    keyAcct: 'anthropic-api-key',
    keyHint: 'sk-ant-...',
    models:  ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id:      'gemini',
    name:    'Google Gemini',
    logo:    '✦',
    color:   '#4285f4',
    keyAcct: 'gemini-api-key',
    keyHint: 'AIza...',
    models:  ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
    docsUrl: 'https://aistudio.google.com/app/apikey',
    requiresKey: true,
  },
  {
    id:        'ollama',
    name:      'Ollama (Local)',
    logo:      '🦙',
    color:     '#6B8E23',
    keyAcct:   'ollama-endpoint',
    keyHint:   'http://localhost:11434',
    models:    ['llava', 'llava:13b', 'llava:34b', 'bakllava', 'moondream', 'llava-llama3'],
    docsUrl:   'https://ollama.com',
    requiresKey: false,
    isLocal:   true,
    endpointLabel: 'Ollama Endpoint',
    description: 'Run vision models locally on your own machine. Requires Ollama installed and a vision model pulled (e.g. ollama pull llava).',
  },
  {
    id:        'localai',
    name:      'Local / Custom Endpoint',
    logo:      '⚡',
    color:     '#9B59B6',
    keyAcct:   'localai-endpoint',
    keyHint:   'http://localhost:8080',
    models:    ['gpt-4-vision-preview', 'llava', 'custom-model'],
    docsUrl:   'https://localai.io',
    requiresKey: false,
    isLocal:   true,
    endpointLabel: 'API Endpoint',
    description: 'Connect any OpenAI-compatible local server: LocalAI, LM Studio, Jan, Kobold, text-generation-webui, and more.',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════════

// ── Status pill ───────────────────────────────────────────────────────────────
function StatusPill({ state }) {
  const config = {
    configured: { label: 'Configured',   bg: 'rgba(169,199,255,0.1)', color: T.primary,   dot: '#4fc98a' },
    validating: { label: 'Validating…',  bg: 'rgba(255,186,56,0.1)',  color: T.tertiary,  dot: T.tertiary },
    valid:      { label: 'Key Valid ✓',  bg: 'rgba(79,201,138,0.12)', color: '#4fc98a',   dot: '#4fc98a' },
    invalid:    { label: 'Invalid Key',  bg: 'rgba(255,180,171,0.12)',color: T.error,     dot: T.error },
    empty:      { label: 'Not set',      bg: 'transparent',           color: T.outlineVariant, dot: T.outlineVariant },
  }[state] ?? { label: state, bg: 'transparent', color: T.onSurfaceVariant, dot: T.outlineVariant };

  return (
    <span style={{
      display:      'inline-flex',
      alignItems:   'center',
      gap:          6,
      padding:      '3px 10px',
      borderRadius: 100,
      background:   config.bg,
      color:        config.color,
      fontSize:     11,
      fontWeight:   600,
      letterSpacing:.3,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: config.dot,
        boxShadow:  `0 0 6px ${config.dot}`,
        animation:  state === 'validating' ? 'pulse 1s ease-in-out infinite' : 'none',
      }}/>
      {config.label}
    </span>
  );
}

// ── Amber underline field ─────────────────────────────────────────────────────
function SecureField({ label, value, onChange, placeholder, type = 'password', monospace = false }) {
  const [focused, setFocused] = useState(false);
  const [show,    setShow]    = useState(false);

  return (
    <div style={{ position: 'relative', marginBottom: 4 }}>
      {/* Floating label */}
      <label style={{
        display:      'block',
        fontSize:     11,
        fontWeight:   500,
        color:        focused ? T.tertiary : T.onSurfaceVariant,
        marginBottom: 6,
        letterSpacing:.4,
        textTransform:'uppercase',
        transition:   'color .2s',
      }}>
        {label}
      </label>

      <div style={{ position: 'relative' }}>
        <input
          type={type === 'password' && !show ? 'password' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          spellCheck={false}
          autoComplete="off"
          style={{
            width:           '100%',
            background:      T.surfaceLowest,
            border:          'none',
            borderBottom:    `2px solid ${focused ? T.tertiary : T.outlineVariant}`,
            borderRadius:    '4px 4px 0 0',
            padding:         '10px 36px 10px 12px',
            color:           T.onSurface,
            fontSize:        13,
            fontFamily:      monospace ? "'DM Mono', monospace" : "'Inter', sans-serif",
            outline:         'none',
            transition:      'border-color .2s',
            boxShadow:       focused ? `0 2px 8px rgba(255,186,56,0.08)` : 'none',
          }}
        />
        {type === 'password' && (
          <button
            onClick={() => setShow(s => !s)}
            style={{
              position:   'absolute', right: 10, top: '50%',
              transform:  'translateY(-50%)',
              background: 'none', border: 'none',
              color:      T.onSurfaceVariant, cursor: 'pointer',
              fontSize:   14, lineHeight: 1, padding: 2,
            }}
            title={show ? 'Hide' : 'Show'}
          >
            {show ? '◎' : '●'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Provider card ─────────────────────────────────────────────────────────────
function ProviderCard({ provider, isActive, credStatus, onActivate, onSave, onValidate }) {
  const [keyValue,      setKeyValue]      = useState('');
  const [endpointValue, setEndpointValue] = useState(provider.isLocal ? (provider.keyHint || '') : '');
  const [modelValue,    setModelValue]    = useState(provider.models[0]);
  const [customModel,   setCustomModel]   = useState('');
  const [validState,    setValidState]    = useState(credStatus ? 'configured' : 'empty');
  const [saving,        setSaving]        = useState(false);

  // Sync external status
  useEffect(() => {
    setValidState(credStatus ? 'configured' : 'empty');
  }, [credStatus]);

  async function handleSave() {
    if (provider.isLocal) {
      if (!endpointValue.trim()) return;
    } else {
      if (!keyValue.trim()) return;
    }
    setSaving(true);
    try {
      if (provider.isLocal) {
        // For local providers, store the endpoint URL as the "key"
        await window.echoQBot.credentials.set(provider.keyAcct, endpointValue.trim());
        await window.echoQBot.credentials.set(`${provider.id}-endpoint`, endpointValue.trim());
      } else {
        await window.echoQBot.credentials.set(provider.keyAcct, keyValue.trim());
      }
      const finalModel = customModel.trim() || modelValue;
      await window.echoQBot.credentials.set('ai-provider', provider.id);
      await window.echoQBot.credentials.set('ai-model',    finalModel);
      await window.echoQBot.credentials.set(`${provider.id}-model`, finalModel);
      setValidState('configured');
      setKeyValue('');
      onSave?.(provider.id, finalModel);
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidState('validating');
    try {
      const res = await window.echoQBot.ai.validateKey(provider.id);
      setValidState(res.ok ? 'valid' : 'invalid');
      onValidate?.(provider.id, res.ok);
    } catch {
      setValidState('invalid');
    }
  }

  async function handleDelete() {
    await window.echoQBot.credentials.delete(provider.keyAcct);
    setValidState('empty');
    setKeyValue('');
  }

  return (
    <div
      onClick={onActivate}
      style={{
        background:   isActive ? T.surfaceHigh : T.surfaceContainer,
        borderRadius: 8,
        padding:      '16px 20px',
        cursor:       'pointer',
        transition:   'background .2s',
        position:     'relative',
        overflow:     'hidden',
      }}
    >
      {/* Active accent bar */}
      {isActive && (
        <div style={{
          position:   'absolute', left: 0, top: 0, bottom: 0,
          width:      4, background: T.tertiary,
          borderRadius: '4px 0 0 4px',
        }}/>
      )}

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isActive ? 16 : 0 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background:  `${provider.color}18`,
          border:      `1px solid ${provider.color}30`,
          display:     'flex', alignItems: 'center', justifyContent: 'center',
          fontSize:    18, color: provider.color,
        }}>
          {provider.logo}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'Manrope', fontWeight: 700, fontSize: 14, color: T.onSurface }}>
            {provider.name}
          </div>
          <div style={{ fontSize: 11, color: T.onSurfaceVariant, marginTop: 2 }}>
            {provider.models.slice(0,2).join(' · ')}
          </div>
        </div>
        <StatusPill state={validState} />
        <div style={{
          fontSize: 16, color: T.onSurfaceVariant,
          transform: isActive ? 'rotate(90deg)' : 'none',
          transition: 'transform .2s',
        }}>›</div>
      </div>

      {/* Expanded form */}
      {isActive && (
        <div onClick={e => e.stopPropagation()}>
          <SecureField
            label="API Key"
            value={keyValue}
            onChange={setKeyValue}
            placeholder={provider.keyHint}
            monospace
          />

          <div style={{ marginTop: 12, marginBottom: 4 }}>
            <label style={{
              fontSize: 11, fontWeight: 500, color: T.onSurfaceVariant,
              textTransform: 'uppercase', letterSpacing: .4, display: 'block', marginBottom: 6,
            }}>
              Model
            </label>
            <select
              value={modelValue}
              onChange={e => setModelValue(e.target.value)}
              style={{
                width:        '100%',
                background:   T.surfaceLowest,
                border:       'none',
                borderBottom: `2px solid ${T.outlineVariant}`,
                borderRadius: '4px 4px 0 0',
                padding:      '9px 12px',
                color:        T.onSurface,
                fontSize:     13,
                fontFamily:   "'Inter', sans-serif",
                outline:      'none',
                cursor:       'pointer',
              }}
            >
              {provider.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button
              onClick={handleSave}
              disabled={saving || !keyValue.trim()}
              style={{
                flex:         1,
                padding:      '9px 16px',
                background:   keyValue.trim() ? T.tertiary : T.surfaceBright,
                color:        keyValue.trim() ? T.onTertiary : T.onSurfaceVariant,
                border:       'none',
                borderRadius: 6,
                fontFamily:   "'Inter', sans-serif",
                fontWeight:   600,
                fontSize:     13,
                cursor:       keyValue.trim() ? 'pointer' : 'not-allowed',
                transition:   'all .15s',
              }}
            >
              {saving ? 'Saving…' : 'Save to Keychain'}
            </button>

            {validState !== 'empty' && (
              <>
                <button
                  onClick={handleValidate}
                  disabled={validState === 'validating'}
                  style={{
                    padding:      '9px 14px',
                    background:   'transparent',
                    color:        T.primary,
                    border:       `1px solid ${T.outlineVariant}`,
                    borderRadius: 6,
                    fontFamily:   "'Inter', sans-serif",
                    fontWeight:   500,
                    fontSize:     12,
                    cursor:       'pointer',
                  }}
                >
                  Validate
                </button>
                <button
                  onClick={handleDelete}
                  style={{
                    padding:      '9px 14px',
                    background:   'transparent',
                    color:        T.error,
                    border:       `1px solid ${T.errorContainer}`,
                    borderRadius: 6,
                    fontFamily:   "'Inter', sans-serif",
                    fontWeight:   500,
                    fontSize:     12,
                    cursor:       'pointer',
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </div>

          <div style={{
            marginTop:   10,
            fontSize:    11,
            color:       T.onSurfaceVariant,
            display:     'flex',
            alignItems:  'center',
            gap:         6,
          }}>
            <span>🔒</span>
            <span>Stored in {navigator.platform.includes('Win') ? 'Windows Credential Manager' : 'macOS Keychain'} via keytar</span>
            <button
              onClick={() => window.echoQBot.system.openExternal({ url: provider.docsUrl })}
              style={{ background: 'none', border: 'none', color: T.primary, cursor: 'pointer', fontSize: 11, padding: 0, marginLeft: 'auto' }}
            >
              Get key →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Jira section ──────────────────────────────────────────────────────────────
function JiraSection({ status, onSaved }) {
  const [domain,  setDomain]  = useState('');
  const [email,   setEmail]   = useState('');
  const [token,   setToken]   = useState('');
  const [project, setProject] = useState('');
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  async function handleSave() {
    setSaving(true);
    try {
      if (domain.trim())  await window.echoQBot.credentials.set('jira-domain',    domain.trim().replace(/\/$/, ''));
      if (email.trim())   await window.echoQBot.credentials.set('jira-email',     email.trim());
      if (token.trim())   await window.echoQBot.credentials.set('jira-api-token', token.trim());
      if (project.trim()) await window.echoQBot.credentials.set('jira-project',   project.trim().toUpperCase());
      setToken('');  // clear sensitive field
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.echoQBot.jira.loadProjects();
      setTestResult(res.ok
        ? { ok: true,  msg: `Connected — ${res.projects?.length ?? 0} projects found` }
        : { ok: false, msg: res.error ?? 'Connection failed' });
    } catch (e) {
      setTestResult({ ok: false, msg: e.message });
    } finally {
      setTesting(false);
    }
  }

  const configured = status?.['jira-domain'] || status?.['jira-email'] || status?.['jira-api-token'];

  return (
    <div style={{ background: T.surfaceContainer, borderRadius: 8, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
        }}>
          🎫
        </div>
        <div>
          <div style={{ fontFamily: 'Manrope', fontWeight: 700, fontSize: 14, color: T.onSurface }}>
            Jira Cloud + Xray
          </div>
          <div style={{ fontSize: 11, color: T.onSurfaceVariant, marginTop: 2 }}>
            Fetch test cases · Create bug tickets
          </div>
        </div>
        <StatusPill state={configured ? 'configured' : 'empty'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <SecureField
          label="Jira Domain"
          value={domain}
          onChange={setDomain}
          placeholder="yourco.atlassian.net"
          type="text"
        />
        <SecureField
          label="Email"
          value={email}
          onChange={setEmail}
          placeholder="you@company.com"
          type="text"
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <SecureField
          label="API Token"
          value={token}
          onChange={setToken}
          placeholder="Your Atlassian API token"
          monospace
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <SecureField
          label="Default Project Key"
          value={project}
          onChange={setProject}
          placeholder="QA"
          type="text"
        />
      </div>

      {testResult && (
        <div style={{
          marginTop:   12,
          padding:     '8px 14px',
          borderRadius: 6,
          background:  testResult.ok ? 'rgba(79,201,138,0.08)' : 'rgba(255,180,171,0.08)',
          color:       testResult.ok ? '#4fc98a' : T.error,
          fontSize:    12,
        }}>
          {testResult.ok ? '✓' : '✗'} {testResult.msg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex:         1,
            padding:      '9px 16px',
            background:   T.tertiary,
            color:        T.onTertiary,
            border:       'none',
            borderRadius: 6,
            fontFamily:   "'Inter', sans-serif",
            fontWeight:   600,
            fontSize:     13,
            cursor:       'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save Credentials'}
        </button>
        <button
          onClick={handleTestConnection}
          disabled={testing}
          style={{
            padding:      '9px 16px',
            background:   'transparent',
            color:        T.primary,
            border:       `1px solid ${T.outlineVariant}`,
            borderRadius: 6,
            fontFamily:   "'Inter', sans-serif",
            fontWeight:   500,
            fontSize:     12,
            cursor:       'pointer',
          }}
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: T.onSurfaceVariant }}>
        🔒 Stored securely via keytar · Get token at id.atlassian.com → Security → API tokens
      </div>
    </div>
  );
}


// ── FAQ accordion item ────────────────────────────────────────────────────────
function FaqItem({ q, a }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{
      background: open ? T.surfaceHigh : T.surfaceContainer,
      borderRadius: 8, marginBottom: 6, cursor: 'pointer',
      transition: 'background .15s',
      borderLeft: open ? `3px solid ${T.primary}` : `3px solid transparent`,
    }} onClick={() => setOpen(o => !o)}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 14px',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.onSurface, flex: 1, lineHeight: 1.4 }}>{q}</div>
        <div style={{ color: T.onSurfaceVariant, fontSize: 14, marginLeft: 10, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}>›</div>
      </div>
      {open && (
        <div style={{ padding: '0 14px 12px', fontSize: 12, color: T.onSurfaceVariant, lineHeight: 1.65 }}>{a}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Settings screen
// ═══════════════════════════════════════════════════════════════════════════════

export default function Settings({ onBack }) {
  const [activeProvider, setActiveProvider] = useState('openai');
  const [credStatus,     setCredStatus]     = useState({});
  const [activeSection,  setActiveSection]  = useState('ai'); // 'ai' | 'jira' | 'about'
  const [saved,          setSaved]          = useState(false);

  // Load credential status on mount
  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const res = await window.echoQBot.credentials.status();
      if (res.ok) setCredStatus(res.status);
    } catch (e) {
      console.error('Failed to load credential status:', e);
    }
  }

  function handleSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    loadStatus();
  }

  const navItems = [
    { id: 'ai',    label: 'AI Providers',  icon: '◎' },
    { id: 'jira',  label: 'Jira & Xray',   icon: '🎫' },
    { id: 'about', label: 'About',          icon: 'ℹ' },
  ];

  return (
    <div style={{
      display:    'flex',
      height:     '100vh',
      background: T.surface,
      fontFamily: "'Inter', sans-serif",
      color:      T.onSurface,
      overflow:   'hidden',
    }}>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes pulse {
          0%,100% { opacity: 1; }
          50%      { opacity: .4; }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(12px); }
          to   { opacity: 1; transform: none; }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${T.outlineVariant}; border-radius: 2px; }
        input::placeholder, textarea::placeholder { color: ${T.outlineVariant}; }
        input, select, textarea { caret-color: ${T.tertiary}; }
      `}</style>

      {/* ── Left nav pane ── */}
      <aside style={{
        width:      240,
        background: T.surfaceLow,
        padding:    '0 0 24px',
        display:    'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        {/* Back + title */}
        <div style={{ padding: '20px 20px 16px' }}>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                display:     'flex', alignItems: 'center', gap: 6,
                background:  'none', border: 'none',
                color:       T.onSurfaceVariant, cursor: 'pointer',
                fontSize:    12, padding: '4px 0', marginBottom: 16,
              }}
            >
              ← Back
            </button>
          )}
          <div style={{
            fontFamily:    'Manrope',
            fontWeight:    800,
            fontSize:      20,
            color:         T.onSurface,
            letterSpacing: '-0.02em',
          }}>
            Settings
          </div>
          <div style={{ fontSize: 11, color: T.onSurfaceVariant, marginTop: 3 }}>
            Security & Configuration
          </div>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '0 12px' }}>
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              style={{
                width:        '100%',
                display:      'flex',
                alignItems:   'center',
                gap:          12,
                padding:      '10px 12px',
                background:   activeSection === item.id ? T.surfaceHigh : 'none',
                border:       'none',
                borderRadius: 6,
                color:        activeSection === item.id ? T.onSurface : T.onSurfaceVariant,
                fontSize:     13,
                fontWeight:   activeSection === item.id ? 600 : 400,
                fontFamily:   "'Inter', sans-serif",
                cursor:       'pointer',
                textAlign:    'left',
                transition:   'all .15s',
                position:     'relative',
              }}
            >
              {activeSection === item.id && (
                <div style={{
                  position: 'absolute', left: 0, top: 6, bottom: 6,
                  width: 3, background: T.tertiary, borderRadius: '0 2px 2px 0',
                }}/>
              )}
              <span style={{ fontSize: 15 }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Platform info */}
        <div style={{ padding: '0 20px', fontSize: 10, color: T.outlineVariant }}>
          Echo Q Bot · v1.0.0
        </div>
      </aside>

      {/* ── Main content ── */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px', animation: 'slideIn .2s ease' }}>

        {/* Save toast */}
        {saved && (
          <div style={{
            position:   'fixed', top: 24, right: 24, zIndex: 9999,
            background: T.surfaceBright,
            padding:    '10px 20px', borderRadius: 8,
            fontSize:   13, fontWeight: 600,
            color:      '#4fc98a',
            boxShadow:  '0 8px 24px rgba(0,93,183,0.2)',
          }}>
            ✓ Saved to keychain
          </div>
        )}

        {/* ── AI Providers section ── */}
        {activeSection === 'ai' && (
          <div style={{ maxWidth: 640 }}>
            <div style={{ marginBottom: 28 }}>
              <h1 style={{
                fontFamily:    'Manrope',
                fontWeight:    800,
                fontSize:      24,
                color:         T.onSurface,
                letterSpacing: '-0.02em',
                marginBottom:  6,
              }}>
                AI Providers
              </h1>
              <p style={{ fontSize: 13, color: T.onSurfaceVariant, lineHeight: 1.6 }}>
                Configure your LLM provider for the agentic automation engine.
                Keys are stored in your OS keychain — never on disk or transmitted to third parties.
              </p>
            </div>

            {/* Glassmorphism info panel */}
            <div style={{
              background:   'rgba(51,53,55,0.6)',
              backdropFilter: 'blur(20px)',
              borderRadius: 10,
              padding:      '14px 18px',
              marginBottom: 24,
              display:      'flex',
              gap:          12,
              alignItems:   'flex-start',
            }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>✦</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.primary, marginBottom: 3 }}>
                  Vision models required
                </div>
                <div style={{ fontSize: 11, color: T.onSurfaceVariant, lineHeight: 1.6 }}>
                  Echo Q Bot uses vision to analyze screenshots. Use <strong style={{color:T.onSurface}}>gpt-4o</strong>,
                  {' '}<strong style={{color:T.onSurface}}>claude-sonnet-4-6</strong>, or
                  {' '}<strong style={{color:T.onSurface}}>gemini-1.5-pro</strong> for best results.
                </div>
              </div>
            </div>

            {/* Provider cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {AI_PROVIDERS.map(provider => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  isActive={activeProvider === provider.id}
                  credStatus={credStatus[provider.keyAcct]}
                  onActivate={() => setActiveProvider(provider.id)}
                  onSave={handleSaved}
                  onValidate={() => {}}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Jira section ── */}
        {activeSection === 'jira' && (
          <div style={{ maxWidth: 640 }}>
            <div style={{ marginBottom: 28 }}>
              <h1 style={{
                fontFamily: 'Manrope', fontWeight: 800, fontSize: 24,
                color: T.onSurface, letterSpacing: '-0.02em', marginBottom: 6,
              }}>
                Jira &amp; Xray
              </h1>
              <p style={{ fontSize: 13, color: T.onSurfaceVariant, lineHeight: 1.6 }}>
                Connect to Jira Cloud to fetch Xray test cases and auto-create bug tickets on failures.
                Your API token is stored in the OS keychain via keytar.
              </p>
            </div>

            <JiraSection status={credStatus} onSaved={handleSaved} />
          </div>
        )}

        {/* ── About section ── */}
        {activeSection === 'about' && (
          <div style={{ maxWidth: 600 }}>

            {/* Logo hero */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '28px 24px', marginBottom: 24,
              background: T.surfaceContainer, borderRadius: 12,
            }}>
              <img src="logo.png" alt="Echo Q Bot"
                style={{ width: 90, height: 90, objectFit: 'contain', marginBottom: 14 }}
                onError={e => { e.target.style.display = 'none'; }}
              />
              <div style={{ fontFamily: 'Manrope', fontWeight: 800, fontSize: 24, color: T.onSurface, letterSpacing: '-0.02em' }}>
                Echo Q Bot
              </div>
              <div style={{ fontSize: 12, color: T.onSurfaceVariant, marginTop: 4 }}>
                AI-Powered QA Automation · v1.0.0 · echoqbot.com
              </div>
              <div style={{ fontSize: 11, color: T.onSurfaceVariant, marginTop: 8 }}>
                Developed with ❤️ by{' '}
                <button
                  onClick={() => window.echoQBot.system.openExternal({ url: 'https://github.com/hadnan1994' })}
                  style={{ background:'none', border:'none', color:T.primary, cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:"Inter,sans-serif", padding:0 }}
                >
                  Hunmble Adnan
                </button>
                {' '}· github.com/hadnan1994
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                {[
                  { label: 'Website',        url: 'https://echoqbot.com' },
                  { label: 'Playwright docs', url: 'https://playwright.dev' },
                ].map(btn => (
                  <button key={btn.label}
                    onClick={() => window.echoQBot.system.openExternal({ url: btn.url })}
                    style={{
                      padding: '6px 14px', background: 'transparent',
                      color: T.primary, border: `1px solid ${T.outlineVariant}`,
                      borderRadius: 6, fontFamily: "Inter,sans-serif",
                      fontSize: 11, fontWeight: 500, cursor: 'pointer',
                    }}
                  >{btn.label} →</button>
                ))}
                <button
                  onClick={() => window.echoQBot.system.openExternal({ url: 'mailto:support@echoqbot.com?subject=Echo Q Bot Support' })}
                  style={{
                    padding: '6px 14px',
                    background: T.tertiaryContainer,
                    color: T.tertiary,
                    border: 'none',
                    borderRadius: 6, fontFamily: "Inter,sans-serif",
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  ✉ support@echoqbot.com
                </button>
              </div>
            </div>

            {/* Setup Guide */}
            <div style={{ fontFamily: 'Manrope', fontWeight: 800, fontSize: 16, color: T.onSurface, marginBottom: 12 }}>🚀 Setup Guide</div>
            {[
              { step:'1', title:'Configure an AI Provider', body:'Go to Settings → AI Providers. Choose OpenAI, Anthropic, or Gemini. Paste your API key and click Save to Keychain. Recommended: GPT-4o or Claude Sonnet 4.6 for best results. GPT-4o-mini or Claude Haiku for faster cheaper runs.', links:[{label:'Get OpenAI key',url:'https://platform.openai.com/api-keys'},{label:'Get Anthropic key',url:'https://console.anthropic.com/settings/keys'},{label:'Get Gemini key',url:'https://aistudio.google.com/app/apikey'}] },
              { step:'2', title:'Connect Jira & Xray (optional)', body:'Go to Settings → Jira & Xray. Enter your domain (yourco.atlassian.net), email, and API token. Click Test Connection to verify. Jira is optional — you can also paste steps manually without it.', links:[{label:'Get Jira API token',url:'https://id.atlassian.com/manage-profile/security/api-tokens'}] },
              { step:'3', title:'Load Your Test Steps', body:'You have four options: (A) Enter a Jira issue key to pull Xray test steps. (B) Paste Gherkin scenarios or numbered steps into the Manual Steps box — format is auto-detected. (C) Upload a Playwright .spec.js or .test.js file — steps run directly via Playwright with AI recovering any failures. (D) Mix and match as needed.', links:[] },
              { step:'4', title:'Upload Test Data CSV (optional)', body:'Click "Upload test data CSV" to load a data file. Column headers become {{variables}} you can use in your steps — e.g. {{email}}, {{password}}, {{account}}. Use the row selector to choose which data row runs. Download the template to get started.', links:[] },
              { step:'5', title:'Run & Monitor', body:'Click Start Automation (or Run Spec File for .spec.js files). Echo Q Bot launches a stealth browser and executes your steps. For spec files, Playwright runs each step directly — fast and precise. For Gherkin/manual steps, AI vision decides the action after each screenshot. The agent chat activates if clarification is needed.', links:[] },
              { step:'6', title:'Review Results & File Tickets', body:'Each step shows Passed or Failed with the AI reasoning. Click the Jira button next to any failed step to auto-create a bug ticket with the full AI analysis, step context, and screenshot reference embedded.', links:[] },
            ].map(item => (
              <div key={item.step} style={{ background: T.surfaceContainer, borderRadius: 8, padding: '13px 16px', marginBottom: 8, borderLeft: `3px solid ${T.tertiary}` }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width:22,height:22,borderRadius:'50%',background:T.tertiary,color:T.onTertiary,fontFamily:'Manrope',fontWeight:800,fontSize:11,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1 }}>{item.step}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight:700,fontSize:13,color:T.onSurface,marginBottom:4 }}>{item.title}</div>
                    <div style={{ fontSize:12,color:T.onSurfaceVariant,lineHeight:1.65 }}>{item.body}</div>
                    {item.links.length > 0 && (
                      <div style={{ display:'flex',gap:10,marginTop:7,flexWrap:'wrap' }}>
                        {item.links.map(l => (
                          <button key={l.label} onClick={() => window.echoQBot.system.openExternal({ url: l.url })}
                            style={{ background:'none',border:'none',color:T.primary,cursor:'pointer',fontSize:11,fontWeight:600,fontFamily:"Inter,sans-serif",padding:0 }}
                          >{l.label} →</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* FAQ */}
            <div style={{ fontFamily:'Manrope',fontWeight:800,fontSize:16,color:T.onSurface,margin:'24px 0 12px' }}>❓ FAQ</div>
            {[
              { q:'The browser view is blank — is something wrong?', a:'No — the browser only appears when a test is actively running. Load steps and click Start Automation.' },
              { q:'Do I need Jira to use Echo Q Bot?', a:'No. Jira and Xray are optional. You can paste Gherkin scenarios or numbered steps directly into the Manual Steps box on the Dashboard. Echo Q Bot auto-detects the format and runs them.' },
              { q:'What is Gherkin format?', a:'Gherkin is a plain-English test format used by tools like Cucumber and Xray. Steps start with Given, When, Then, And, or But. Example: "Given I am on the login page / When I enter {{email}} / Then I should see the dashboard".' },
              { q:'How do CSV variables work?', a:'Upload a CSV file where the column headers become {{variables}}. In your steps, write {{email}} or {{password}} and Echo Q Bot substitutes the value from your chosen CSV row before the AI sees the step. Use the row selector to switch between different test data sets — e.g. admin user vs customer user.' },
              { q:'What is the agent chat box for?', a:'When the AI is unsure which element to click or encounters an ambiguous situation, it pauses and asks you a question in the chat box. Type your answer and the run continues. This prevents the agent from guessing wrong and failing a step unnecessarily.' },
              { q:'Which AI model should I use?', a:'GPT-4o or Claude Sonnet 4.6 for best accuracy on complex pages. GPT-4o-mini or Claude Haiku for faster, cheaper runs on simpler tests. All models used must support vision (screenshot analysis).' },
              { q:'Is my API key safe?', a:'Yes. All keys are stored exclusively in Windows Credential Manager (Windows) or macOS Keychain (Mac) via the keytar library. They are never written to disk, logged, or sent anywhere except directly to the AI provider you configured.' },
              { q:'What Jira issue types work with Echo Q Bot?', a:'Any Jira issue with Xray test steps attached. Echo Q Bot uses the Xray REST API to fetch steps, and falls back to parsing the issue description body if Xray is not licensed on your instance.' },
              { q:'A test step failed — what do I do?', a:'Click the orange 🎫 Jira button next to the failed step. A pre-filled ticket modal opens with the AI root cause, step context, and expected vs actual behaviour already filled in. Select your project and create the ticket in one click.' },
              { q:'Can I run the same test with different user accounts?', a:'Yes — this is exactly what the CSV feature is for. Add one row per user account with their credentials and any other variables. Use the row selector to pick which account runs, or build a loop in your test steps.' },
              { q:'How do I open the developer console?', a:'Press Ctrl+Shift+I (Windows) or Cmd+Option+I (Mac) inside the app to open DevTools.' },
              { q:'Is Echo Q Bot free?', a:'Yes, completely free and open source. If you run into issues, email support@echoqbot.com — we typically respond within 3–5 days. If it saves you time, a kind word or star on GitHub goes a long way.' },
              { q:'Can I run existing Playwright test files?', a:'Yes. Upload any .spec.js or .test.js file using the Playwright Spec File panel on the Dashboard. Echo Q Bot parses the test blocks and executes each step directly via Playwright — no AI needed for most steps. If a step fails, AI vision kicks in automatically to attempt recovery before marking it as failed.' },
              { q:'What Playwright syntax is supported in spec files?', a:'Common actions: page.goto(), page.click(), page.fill(), page.type(), page.press(), page.hover(), page.selectOption(), page.check(), page.waitForSelector(), page.reload(). Assertions: expect(page).toHaveURL/Title(), expect(locator).toBeVisible/Hidden/Checked/Enabled/Disabled(), toHaveText(), toHaveValue(), toHaveCount(). Locators: page.locator(), page.getByRole(), page.getByText(), page.getByLabel(). CSV variables work in spec files too — {{email}} gets resolved before execution.' },
              { q:'What is the difference between spec mode and step mode?', a:'Spec mode (.spec.js) runs Playwright commands directly — it is faster, more precise, and works best for teams that already have test suites. Step mode (Gherkin/manual) uses AI vision to interpret each step and decide the action — it is more flexible and works without any existing test code. AI recovery is used in both modes when steps fail.' },
              { q:'Can I use {{variables}} from CSV in my .spec.js file?', a:'Yes. Write {{email}} or {{password}} anywhere in your spec file string values. Echo Q Bot resolves them from your loaded CSV row before execution. For example: await page.fill("#email", "{{email}}") becomes await page.fill("#email", "admin@yourco.com") at runtime.' },
              { q:'Can I use a local AI model instead of OpenAI or Anthropic?', a:'Yes. Echo Q Bot supports Ollama (run models like LLaVA locally on your own machine) and any OpenAI-compatible local server such as LocalAI, LM Studio, Jan, or text-generation-webui. Go to Settings → AI Providers → Ollama or Local / Custom Endpoint. The model must support vision (image input) to analyze screenshots.' },
              { q:'How do I set up Ollama?', a:'Install Ollama from ollama.com, then run: ollama pull llava — this downloads the LLaVA vision model. In Echo Q Bot Settings, select Ollama and enter your endpoint (default: http://localhost:11434). No API key needed — it runs entirely on your machine.' },
              { q:'My local model is slow — is that normal?', a:'Yes. Local models run on your hardware so speed depends on your GPU/CPU and model size. LLaVA 7B is faster than 13B or 34B. If speed is critical, consider GPT-4o-mini or Claude Haiku which are fast cloud options. The automation engine has a 60–120 second timeout for local model responses.' },
            ].map((item, i) => <FaqItem key={i} q={item.q} a={item.a} />)}

            {/* System info */}
            <div style={{ background:T.surfaceContainer,borderRadius:8,padding:'13px 16px',marginTop:24 }}>
              <div style={{ fontFamily:'Manrope',fontWeight:700,fontSize:11,color:T.onSurfaceVariant,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:8 }}>System Info</div>
              {[
                { label:'Version',         value:'1.0.0' },
                { label:'Electron',        value: navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] ?? '—' },
                { label:'Node.js',         value: '20.x' },
                { label:'Chromium',        value: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '—' },
                { label:'Platform',        value:navigator.platform },
                { label:'Credential Store',value:navigator.platform.includes('Win') ? 'Windows Credential Manager' : 'macOS Keychain' },
              ].map(row => (
                <div key={row.label} style={{ display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:`1px solid ${T.surfaceHigh}`,fontSize:12 }}>
                  <span style={{ color:T.onSurfaceVariant }}>{row.label}</span>
                  {row.label === 'Support' ? (
                    <button
                      onClick={() => window.echoQBot.system.openExternal({ url:`mailto:${row.value}?subject=Echo Q Bot Support` })}
                      style={{ background:'none',border:'none',color:T.primary,cursor:'pointer',fontFamily:'monospace',fontSize:11,padding:0 }}
                    >{row.value}</button>
                  ) : (
                    <span style={{ color:T.onSurface,fontFamily:'monospace',fontSize:11 }}>{row.value}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
