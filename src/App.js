import React, { useState, useEffect } from 'react';
import Settings from './renderer/components/Settings';
import Dashboard from './renderer/components/Dashboard';

// ── Design tokens ─────────────────────────────────────────────
const T = {
  surface:    '#121416',
  surfaceLow: '#1a1c1e',
  onSurface:  '#e2e2e5',
  onSurfaceVariant: '#c3c6d4',
  tertiary:   '#ffba38',
  primary:    '#a9c7ff',
  outlineVariant: '#434652',
};

export default function App() {
  const [screen, setScreen] = useState('dashboard'); // 'dashboard' | 'settings'
  const [extReady, setExtReady] = useState(false);

  useEffect(() => {
    // Check if the preload bridge is available
    setExtReady(!!window.echoQBot);
  }, []);

  // If the echoQBot bridge isn't available (opened in a plain browser instead of Electron)
  if (!extReady) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: T.surface, color: T.onSurfaceVariant,
        fontFamily: "'Inter', sans-serif", gap: 12,
      }}>
        <div style={{ fontSize: 36 }}>⚠</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.onSurface }}>
          Run inside Electron
        </div>
        <div style={{ fontSize: 12, color: T.onSurfaceVariant }}>
          Use <code style={{ color: T.primary }}>npm start</code> or the installed app.
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', background: T.surface, overflow: 'hidden' }}>
      {screen === 'settings'
        ? <Settings onBack={() => setScreen('dashboard')} />
        : <Dashboard onOpenSettings={() => setScreen('settings')} />
      }
    </div>
  );
}
