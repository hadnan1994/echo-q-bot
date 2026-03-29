/**
 * Echo Q Bot — automationEngine.js
 *
 * The agentic automation core.
 *
 * Flow per test step:
 *  1. Capture screenshot + DOM snapshot via Playwright
 *  2. Send to AI (analyzeAndAct) with the current Gherkin/Xray step
 *  3. Execute the returned action in the browser
 *  4. Loop until stepComplete or max retries exceeded
 *  5. Move to next step; emit progress events to the renderer
 *
 * Browser strategy: launches Chromium in "stealth" mode using playwright's
 * own browser binary — completely separate from the user's Chrome profile.
 */

'use strict';

const { AIService }  = require('./aiService');

// ── State ─────────────────────────────────────────────────────────────────────
let _browser    = null;
let _context    = null;
let _page       = null;
let _running    = false;
let _sendEvent  = null;   // injected by main.js
let _status     = 'idle'; // 'idle' | 'running' | 'paused' | 'complete' | 'error'

const MAX_RETRIES_PER_STEP  = 4;
const ACTION_TIMEOUT_MS     = 8000;
const SCREENSHOT_QUALITY    = 80;   // JPEG quality for speed

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start a test run.
 * @param {object} opts
 * @param {Array}  opts.steps       - [{ index, action: string, expected?: string }]
 * @param {string} opts.provider    - 'openai' | 'anthropic' | 'gemini'
 * @param {string} opts.model       - model string
 * @param {string} opts.apiKey      - raw API key (resolved by main.js)
 * @param {string} [opts.startUrl]  - URL to navigate to at the start
 * @param {function} opts.sendEvent - (channel, data) => void
 */
async function start({ steps, provider, model, apiKey, endpoint, startUrl, sendEvent, csvContext, specCode, specMode }) {
  if (_running) {
    sendEvent('automation:error', { message: 'Automation is already running.' });
    return;
  }

  _sendEvent = sendEvent;
  _running   = true;
  _status    = 'running';

  const ai = new AIService({ provider, model, apiKey });

  log('info', `Starting automation — ${steps.length} steps — provider: ${provider} / ${model}`);

  try {
    // ── Spec file mode ──────────────────────────────────────────────────────
    if (specMode && specCode) {
      log('info', 'Running in Playwright Spec File mode');
      await launchBrowser();
      const { AIService }  = require('./aiService');
      const { runSpec }    = require('./specRunner');
      const ai = new AIService({ provider, model, apiKey, endpoint });
      const csvRow = csvContext?.values || {};
      const result = await runSpec({ specCode, page: _page, ai, csvRow, sendEvent: _sendEvent, startUrl });
      _status  = 'complete';
      _running = false;
      sendEvent('automation:complete', {
        total: result.total, passed: result.passed, failed: result.failed,
        timestamp: new Date().toISOString(),
      });
      await closeBrowser();
      return;
    }
    // ── Standard step-by-step mode ───────────────────────────────────────────
    await launchBrowser();
    if (startUrl) await _page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const history = [];
    let passed = 0, failed = 0;

    for (let i = 0; i < steps.length; i++) {
      if (!_running) break; // stop() was called

      const step = steps[i];
      log('info', `▶ Step ${i + 1}/${steps.length}: "${step.action}"`);
      sendEvent('automation:step-update', { stepIndex: i, status: 'running', message: step.action });

      const result = await executeStep({ step, ai, stepIndex: i, history });
      history.push({ step: step.action, action: result.lastAction, result: result.outcome });

      if (result.passed) {
        passed++;
        sendEvent('automation:step-update', {
          stepIndex: i, status: 'passed',
          message: result.reasoning ?? 'Step completed',
          screenshot: result.screenshot,
        });
        log('info', `  ✓ Passed`);
      } else {
        failed++;
        sendEvent('automation:step-update', {
          stepIndex: i, status: 'failed',
          message: result.error ?? 'Step failed',
          screenshot: result.screenshot,
        });
        log('error', `  ✗ Failed: ${result.error}`);

        // Emit a Jira-ready failure event so the renderer can offer ticket creation
        sendEvent('automation:failure-detected', {
          stepIndex:   i,
          stepText:    step.action,
          expected:    step.expected ?? '',
          actual:      result.error  ?? '',
          screenshot:  result.screenshot,
          aiReasoning: result.reasoning ?? '',
        });
      }

      // Brief pause between steps so the page can settle
      await sleep(500);
    }

    _status  = 'complete';
    _running = false;

    const summary = { total: steps.length, passed, failed, timestamp: new Date().toISOString() };
    sendEvent('automation:complete', summary);
    log('info', `Run complete — ${passed} passed, ${failed} failed`);

  } catch (err) {
    _status  = 'error';
    _running = false;
    log('error', `Fatal engine error: ${err.message}`);
    sendEvent('automation:error', { message: err.message });
  } finally {
    await closeBrowser();
  }
}

/**
 * Gracefully stop a running session.
 */
async function stop() {
  _running = false;
  _status  = 'idle';
  log('info', 'Automation stopped by user.');
  await closeBrowser();
}

/**
 * Return current engine status.
 */
function getStatus() {
  return { status: _status, running: _running };
}

// ── Step execution loop ───────────────────────────────────────────────────────

async function executeStep({ step, ai, stepIndex, history }) {
  let retries    = 0;
  let lastAction = null;
  let screenshot = null;
  let reasoning  = '';

  while (retries < MAX_RETRIES_PER_STEP && _running) {
    try {
      // 1. Capture current page state
      const pageState = await capturePageState();
      screenshot = pageState.screenshot;

      // 2. Ask AI what to do
      const aiResponse = await ai.analyzeAndAct({
        screenshot:  pageState.screenshot,
        domTree:     pageState.domTree,
        currentStep: step.action,
        history,
      });

      reasoning  = aiResponse.reasoning ?? '';
      lastAction = aiResponse.action;

      log('info', `  AI action: ${JSON.stringify(aiResponse.action)} (confidence: ${aiResponse.confidence?.toFixed(2)})`);

      // Log the AI insight to the renderer
      _sendEvent?.('automation:log', {
        level:     'ai',
        message:   `[AI] ${reasoning}`,
        timestamp: new Date().toISOString(),
      });

      // If AI spotted an unrelated issue on the page
      if (aiResponse.issueDetected) {
        _sendEvent?.('automation:log', {
          level:   'warn',
          message: `[Issue detected] ${aiResponse.issueDetected}`,
          timestamp: new Date().toISOString(),
        });
      }

      // 3. Execute the action
      if (aiResponse.action.type === 'done') {
        return { passed: true, lastAction, screenshot, reasoning, outcome: 'completed' };
      }

      await performAction(aiResponse.action);

      // 4. If AI says step is complete, exit loop
      if (aiResponse.stepComplete) {
        // Capture final state screenshot
        const finalState = await capturePageState();
        return { passed: true, lastAction, screenshot: finalState.screenshot, reasoning, outcome: 'completed' };
      }

      retries++;
      await sleep(800); // small wait for DOM to update

    } catch (err) {
      retries++;
      log('error', `  Retry ${retries}/${MAX_RETRIES_PER_STEP}: ${err.message}`);
      _sendEvent?.('automation:log', {
        level:     'error',
        message:   `[Retry ${retries}] ${err.message}`,
        timestamp: new Date().toISOString(),
      });

      if (retries >= MAX_RETRIES_PER_STEP) {
        return {
          passed:     false,
          lastAction,
          screenshot,
          reasoning,
          error:   err.message,
          outcome: 'failed',
        };
      }
      await sleep(1200);
    }
  }

  return { passed: false, lastAction, screenshot, reasoning, error: 'Max retries exceeded', outcome: 'failed' };
}

// ── Browser management ────────────────────────────────────────────────────────

async function launchBrowser() {
  const { chromium } = require('playwright');

  log('info', 'Launching stealth browser…');

  _browser = await chromium.launch({
    headless: false,   // visible — QA engineer can watch
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  });

  _context = await _browser.newContext({
    viewport:          { width: 1280, height: 800 },
    userAgent:         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
    // Remove automation markers
    javaScriptEnabled: true,
  });

  // Stealth: remove webdriver flag before every page load
  await _context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins',  { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages',{ get: () => ['en-US', 'en'] });
  });

  _page = await _context.newPage();

  // Forward browser console to the log stream
  _page.on('console', msg => {
    const level = msg.type() === 'error' ? 'error' : 'debug';
    _sendEvent?.('automation:log', {
      level,
      message:   `[browser:${msg.type()}] ${msg.text()}`,
      timestamp: new Date().toISOString(),
    });
  });

  _page.on('pageerror', err => {
    _sendEvent?.('automation:log', {
      level:     'error',
      message:   `[page error] ${err.message}`,
      timestamp: new Date().toISOString(),
    });
  });

  log('info', 'Browser ready.');
}

async function closeBrowser() {
  try {
    if (_page)    { await _page.close().catch(() => {}); _page = null; }
    if (_context) { await _context.close().catch(() => {}); _context = null; }
    if (_browser) { await _browser.close().catch(() => {}); _browser = null; }
  } catch (e) {
    // Non-fatal
  }
}

// ── Page state capture ────────────────────────────────────────────────────────

async function capturePageState() {
  if (!_page) throw new Error('No browser page available');

  // Screenshot as JPEG base64 for speed
  const screenshotBuf = await _page.screenshot({ type: 'jpeg', quality: SCREENSHOT_QUALITY });
  const screenshot    = `data:image/jpeg;base64,${screenshotBuf.toString('base64')}`;

  // Emit screenshot to renderer for live preview
  _sendEvent?.('automation:screenshot', { dataUrl: screenshot });

  // Simplified DOM tree — interactive elements only
  const domTree = await _page.evaluate(() => {
    const INTERACTIVE = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [tabindex]';
    const elements = [...document.querySelectorAll(INTERACTIVE)].slice(0, 60);
    return elements.map(el => {
      const tag    = el.tagName.toLowerCase();
      const text   = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').slice(0, 80).trim();
      const id     = el.id ? `#${el.id}` : '';
      const cls    = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0,2).join('.')}` : '';
      const role   = el.getAttribute('role') ?? '';
      const type   = el.getAttribute('type') ?? '';
      return `${tag}${id}${cls}${role ? `[role=${role}]` : ''}${type ? `[type=${type}]` : ''}: "${text}"`;
    }).join('\n');
  }).catch(() => '(DOM snapshot unavailable)');

  return { screenshot, domTree };
}

// ── Action execution ──────────────────────────────────────────────────────────

async function performAction(action) {
  if (!_page) throw new Error('Browser page not available');

  const timeout = action.timeout ?? ACTION_TIMEOUT_MS;

  switch (action.type) {
    case 'click': {
      const el = await _page.waitForSelector(action.selector, { timeout });
      await el.scrollIntoViewIfNeeded();
      await el.click({ timeout });
      break;
    }

    case 'fill': {
      const el = await _page.waitForSelector(action.selector, { timeout });
      await el.fill(action.value ?? '', { timeout });
      break;
    }

    case 'select': {
      await _page.selectOption(action.selector, action.value, { timeout });
      break;
    }

    case 'press': {
      if (action.selector) {
        await _page.press(action.selector, action.value ?? 'Enter', { timeout });
      } else {
        await _page.keyboard.press(action.value ?? 'Enter');
      }
      break;
    }

    case 'hover': {
      const el = await _page.waitForSelector(action.selector, { timeout });
      await el.hover({ timeout });
      break;
    }

    case 'navigate': {
      await _page.goto(action.url, { waitUntil: 'domcontentloaded', timeout });
      break;
    }

    case 'assert': {
      // Soft assertions — log result but don't throw
      const text = await _page.textContent('body', { timeout }).catch(() => '');
      const pass = text.includes(action.assertion ?? '');
      if (!pass) throw new Error(`Assertion failed: "${action.assertion}" not found on page`);
      break;
    }

    case 'screenshot': {
      // Already captured above — no-op
      break;
    }

    case 'wait': {
      await sleep(action.timeout ?? 2000);
      break;
    }

    case 'done': {
      // Step is complete, nothing to do
      break;
    }

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }

  // After action, wait for any network idle or navigation
  await _page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
}

// ── Utility ───────────────────────────────────────────────────────────────────

function log(level, message) {
  const timestamp = new Date().toISOString();
  console[level === 'error' ? 'error' : 'log'](`[automationEngine] ${message}`);
  _sendEvent?.('automation:log', { level, message, timestamp });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = { start, stop, getStatus };

// ── Agent answer channel ──────────────────────────────────────────────────────
// When AI confidence is low, engine emits automation:agent-question
// and waits for the user to respond via this promise resolver.
let _agentAnswerResolve = null;

/**
 * Called by main.js when renderer sends an agent answer.
 */
function receiveAgentAnswer({ answer }) {
  if (_agentAnswerResolve) {
    _agentAnswerResolve(answer);
    _agentAnswerResolve = null;
  }
}

/**
 * Pause execution and ask the user a question via the chat box.
 * Returns the user's answer as a string.
 */
async function askAgent(question) {
  return new Promise((resolve) => {
    _agentAnswerResolve = resolve;
    _sendEvent?.('automation:agent-question', { question });
    log('ai', `[Agent question] ${question}`);
  });
}

module.exports = { start, stop, getStatus, receiveAgentAnswer, performAction };
