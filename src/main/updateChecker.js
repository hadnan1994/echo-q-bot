/**
 * Echo Q Bot — updateChecker.js
 *
 * Checks echoqbot.com/version.json on startup.
 * If a newer version is available, sends an event to the renderer
 * which shows a subtle update banner in the header.
 *
 * No auto-download — just redirects to echoqbot.com/download.
 * This keeps the update process fully transparent and safe.
 */

'use strict';

const VERSION_URL = 'https://echoqbot.com/version.json';
const CHECK_DELAY  = 5000; // Wait 5s after app launch before checking

/**
 * Compare two semver strings.
 * Returns true if remote > local.
 */
function isNewer(local, remote) {
  try {
    const parse = v => v.replace(/[^0-9.]/g, '').split('.').map(Number);
    const [lMaj, lMin, lPatch] = parse(local);
    const [rMaj, rMin, rPatch] = parse(remote);
    if (rMaj !== lMaj) return rMaj > lMaj;
    if (rMin !== lMin) return rMin > lMin;
    return rPatch > lPatch;
  } catch {
    return false;
  }
}

/**
 * Start the update check.
 * @param {string}   currentVersion  - from package.json
 * @param {Function} sendEvent       - (channel, data) => void
 */
function startUpdateCheck(currentVersion, sendEvent) {
  setTimeout(async () => {
    try {
      const axios    = require('axios');
      const response = await axios.get(VERSION_URL, {
        timeout: 8000,
        headers: { 'Cache-Control': 'no-cache' },
      });

      const data          = response.data;
      const remoteVersion = data?.version;

      if (!remoteVersion) return;

      if (isNewer(currentVersion, remoteVersion)) {
        console.log(`[updateChecker] Update available: ${currentVersion} → ${remoteVersion}`);
        sendEvent('update:available', {
          currentVersion,
          newVersion:   remoteVersion,
          downloadUrl:  data.downloadUrl  || 'https://echoqbot.com/download',
          releaseNotes: data.releaseNotes || '',
          releaseDate:  data.releaseDate  || '',
        });
      } else {
        console.log(`[updateChecker] Up to date: ${currentVersion}`);
      }
    } catch (err) {
      // Silent fail — update check should never crash the app
      console.log('[updateChecker] Check failed (offline or server unavailable):', err.message);
    }
  }, CHECK_DELAY);
}

module.exports = { startUpdateCheck, isNewer };
