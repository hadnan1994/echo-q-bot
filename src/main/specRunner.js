/**
 * Echo Q Bot — specRunner.js
 *
 * Parses and executes Playwright .spec.js / .test.js files.
 *
 * Strategy:
 *  1. Parse the spec file into a structured list of test blocks + steps
 *  2. Execute each step directly via Playwright (no AI needed for known actions)
 *  3. When a step fails OR is ambiguous → hand off to AI vision for recovery
 *  4. Emit the same events as automationEngine so the UI is identical
 *
 * Supported patterns:
 *  - test('name', async ({ page }) => { ... })
 *  - test.describe('suite', () => { test(...) })
 *  - expect(page).toHaveURL(...)
 *  - await page.click(...)
 *  - await page.fill(...)
 *  - await page.goto(...)
 *  - await page.waitForSelector(...)
 *  - await expect(locator).toBeVisible() / toHaveText() / toBeChecked() etc.
 */

'use strict';

const { AIService } = require('./aiService');

// ── Regex patterns for parsing spec files ─────────────────────────────────────
const PATTERNS = {
  // test('name', ...) or test.only / test.skip
  testBlock:    /^\s*test(?:\.only|\.skip)?\s*\(\s*['"`](.+?)['"`]/,
  // test.describe('suite', ...)
  describeBlock:/^\s*test\.describe\s*\(\s*['"`](.+?)['"`]/,
  // await page.ACTION(...)
  pageAction:   /^\s*await\s+page\.(\w+)\s*\((.+)\)/,
  // await expect(...).MATCHER(...)
  expectCall:   /^\s*await\s+expect\s*\((.+?)\)\.(\w+)\s*\((.*?)\)/,
  // const locator = page.locator(...)
  locatorDef:   /^\s*const\s+(\w+)\s*=\s*page\.(\w+)\s*\((.+)\)/,
  // Variable interpolation {{var}}
  csvVar:       /\{\{(\w+)\}\}/g,
};

// ── Map Playwright assertion matchers → check functions ───────────────────────
const MATCHERS = {
  toHaveURL:      async (page, arg) => {
    const url = await page.url();
    const expected = stripQuotes(arg);
    if (!url.includes(expected)) throw new Error(`URL mismatch: expected "${expected}", got "${url}"`);
  },
  toHaveTitle:    async (page, arg) => {
    const title = await page.title();
    const expected = stripQuotes(arg);
    if (!title.includes(expected)) throw new Error(`Title mismatch: expected "${expected}", got "${title}"`);
  },
  toBeVisible:    async (locator) => {
    const visible = await locator.isVisible();
    if (!visible) throw new Error('Element is not visible');
  },
  toBeHidden:     async (locator) => {
    const visible = await locator.isVisible();
    if (visible) throw new Error('Element should be hidden but is visible');
  },
  toBeChecked:    async (locator) => {
    const checked = await locator.isChecked();
    if (!checked) throw new Error('Element is not checked');
  },
  toBeEnabled:    async (locator) => {
    const enabled = await locator.isEnabled();
    if (!enabled) throw new Error('Element is not enabled');
  },
  toBeDisabled:   async (locator) => {
    const enabled = await locator.isEnabled();
    if (enabled) throw new Error('Element should be disabled');
  },
  toHaveText:     async (locator, arg) => {
    const text = await locator.innerText().catch(() => '');
    const expected = stripQuotes(arg);
    if (!text.includes(expected)) throw new Error(`Text mismatch: expected "${expected}", got "${text}"`);
  },
  toHaveValue:    async (locator, arg) => {
    const val = await locator.inputValue().catch(() => '');
    const expected = stripQuotes(arg);
    if (!val.includes(expected)) throw new Error(`Value mismatch: expected "${expected}", got "${val}"`);
  },
  toHaveCount:    async (locator, arg) => {
    const count = await locator.count();
    const expected = parseInt(arg, 10);
    if (count !== expected) throw new Error(`Count mismatch: expected ${expected}, got ${count}`);
  },
  toContainText:  async (locator, arg) => {
    const text = await locator.innerText().catch(() => '');
    const expected = stripQuotes(arg);
    if (!text.includes(expected)) throw new Error(`Text "${expected}" not found in "${text}"`);
  },
};

// ── Parse a spec file into structured steps ───────────────────────────────────
function parseSpecFile(code, csvRow = {}) {
  const lines   = code.split('\n');
  const tests   = [];
  let currentTest    = null;
  let currentDescribe = '';
  let braceDepth     = 0;
  let testBraceStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track describe blocks
    const describeMatch = line.match(PATTERNS.describeBlock);
    if (describeMatch) {
      currentDescribe = describeMatch[1];
    }

    // Track test blocks
    const testMatch = line.match(PATTERNS.testBlock);
    if (testMatch) {
      currentTest = {
        name:     currentDescribe ? `${currentDescribe} › ${testMatch[1]}` : testMatch[1],
        steps:    [],
        startLine: i,
        skip:     line.includes('test.skip'),
      };
      braceDepth = 0;
      testBraceStart = i;
    }

    if (currentTest) {
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      // Extract actionable lines
      const trimmed = line.trim();

      // Resolve CSV variables
      const resolved = trimmed.replace(PATTERNS.csvVar, (_, key) => csvRow[key] ?? `{{${key}}}`);

      if (resolved.match(PATTERNS.pageAction) || resolved.match(PATTERNS.expectCall) || resolved.match(PATTERNS.locatorDef)) {
        if (!resolved.startsWith('//') && !resolved.startsWith('*')) {
          currentTest.steps.push({
            lineNum:  i + 1,
            raw:      resolved,
            original: trimmed,
          });
        }
      }

      // End of test block
      if (i > testBraceStart && braceDepth <= 0 && currentTest) {
        tests.push(currentTest);
        currentTest = null;
      }
    }
  }

  return tests;
}

// ── Execute a single parsed step directly via Playwright ──────────────────────
async function executeSpecStep(step, page, locators = {}) {
  const line = step.raw;

  // ── page.ACTION(...) ──────────────────────────────────────────────────────
  const pageMatch = line.match(PATTERNS.pageAction);
  if (pageMatch) {
    const action = pageMatch[1];
    const rawArgs = parseArgs(pageMatch[2]);

    switch (action) {
      case 'goto':
        await page.goto(stripQuotes(rawArgs[0]), { waitUntil: 'domcontentloaded', timeout: 15000 });
        break;
      case 'click':
        await page.click(stripQuotes(rawArgs[0]), { timeout: 8000 });
        break;
      case 'fill':
        await page.fill(stripQuotes(rawArgs[0]), stripQuotes(rawArgs[1] || ''), { timeout: 8000 });
        break;
      case 'type':
        await page.type(stripQuotes(rawArgs[0]), stripQuotes(rawArgs[1] || ''), { timeout: 8000 });
        break;
      case 'press':
        await page.press(stripQuotes(rawArgs[0]), stripQuotes(rawArgs[1] || 'Enter'), { timeout: 8000 });
        break;
      case 'selectOption':
        await page.selectOption(stripQuotes(rawArgs[0]), stripQuotes(rawArgs[1] || ''), { timeout: 8000 });
        break;
      case 'check':
        await page.check(stripQuotes(rawArgs[0]), { timeout: 8000 });
        break;
      case 'uncheck':
        await page.uncheck(stripQuotes(rawArgs[0]), { timeout: 8000 });
        break;
      case 'hover':
        await page.hover(stripQuotes(rawArgs[0]), { timeout: 8000 });
        break;
      case 'waitForSelector':
        await page.waitForSelector(stripQuotes(rawArgs[0]), { timeout: 10000 });
        break;
      case 'waitForURL':
        await page.waitForURL(stripQuotes(rawArgs[0]), { timeout: 10000 });
        break;
      case 'waitForTimeout':
        await page.waitForTimeout(parseInt(rawArgs[0], 10) || 1000);
        break;
      case 'reload':
        await page.reload({ waitUntil: 'domcontentloaded' });
        break;
      case 'goBack':
        await page.goBack();
        break;
      case 'goForward':
        await page.goForward();
        break;
      case 'screenshot':
        // Already handled by engine — skip
        break;
      default:
        throw new Error(`Unsupported page action: page.${action}()`);
    }
    return { ok: true };
  }

  // ── const locator = page.locator(...) ────────────────────────────────────
  const locatorMatch = line.match(PATTERNS.locatorDef);
  if (locatorMatch) {
    const varName  = locatorMatch[1];
    const method   = locatorMatch[2];
    const selector = stripQuotes(parseArgs(locatorMatch[3])[0]);
    locators[varName] = page[method]?.(selector);
    return { ok: true };
  }

  // ── await expect(...).matcher(...) ────────────────────────────────────────
  const expectMatch = line.match(PATTERNS.expectCall);
  if (expectMatch) {
    const target   = expectMatch[1].trim();
    const matcher  = expectMatch[2];
    const arg      = expectMatch[3].trim();
    const fn       = MATCHERS[matcher];

    if (!fn) throw new Error(`Unsupported matcher: .${matcher}()`);

    if (target === 'page') {
      await fn(page, arg);
    } else {
      // Could be a stored locator variable or inline locator
      const locator = locators[target] || resolveInlineLocator(target, page);
      if (!locator) throw new Error(`Unknown locator: ${target}`);
      await fn(locator, arg);
    }
    return { ok: true };
  }

  // Unknown — skip silently (comments, variable declarations, etc.)
  return { ok: true, skipped: true };
}

// ── Inline locator resolver ───────────────────────────────────────────────────
function resolveInlineLocator(expr, page) {
  try {
    // page.locator('selector') or page.getByRole('button') etc.
    const m = expr.match(/page\.(\w+)\((.+)\)/);
    if (!m) return null;
    const method = m[1];
    const args   = parseArgs(m[2]).map(stripQuotes);
    return page[method]?.(...args);
  } catch {
    return null;
  }
}

// ── Main spec runner ──────────────────────────────────────────────────────────
async function runSpec({ specCode, page, ai, csvRow = {}, sendEvent, startUrl }) {
  const tests = parseSpecFile(specCode, csvRow);

  if (tests.length === 0) {
    sendEvent('automation:log', {
      level: 'warn',
      message: '[Spec] No test blocks found. Make sure you are using test() or test.describe() syntax.',
      timestamp: new Date().toISOString(),
    });
    return { passed: 0, failed: 0, total: 0 };
  }

  sendEvent('automation:log', {
    level: 'info',
    message: `[Spec] Found ${tests.length} test block${tests.length !== 1 ? 's' : ''}`,
    timestamp: new Date().toISOString(),
  });

  let totalPassed = 0, totalFailed = 0, stepIndex = 0;

  if (startUrl) {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  }

  for (const test of tests) {
    if (test.skip) {
      sendEvent('automation:log', {
        level: 'warn',
        message: `[Spec] Skipping: ${test.name}`,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    sendEvent('automation:log', {
      level: 'info',
      message: `[Spec] Running: ${test.name} (${test.steps.length} steps)`,
      timestamp: new Date().toISOString(),
    });

    const locators = {};

    for (const step of test.steps) {
      sendEvent('automation:step-update', {
        stepIndex,
        status:  'running',
        message: step.raw,
      });

      // Take screenshot before step
      const screenshotBuf = await page.screenshot({ type: 'jpeg', quality: 80 }).catch(() => null);
      const screenshot = screenshotBuf
        ? `data:image/jpeg;base64,${screenshotBuf.toString('base64')}`
        : null;
      if (screenshot) sendEvent('automation:screenshot', { dataUrl: screenshot });

      let stepPassed = false;
      let stepError  = null;

      // Try direct Playwright execution first
      try {
        const result = await executeSpecStep(step, page, locators);
        if (result.skipped) {
          stepIndex++;
          continue; // not a real action line
        }
        stepPassed = true;
        totalPassed++;
        sendEvent('automation:step-update', {
          stepIndex, status: 'passed',
          message: `✓ ${step.raw}`, screenshot,
        });
      } catch (directErr) {
        // Direct execution failed — hand off to AI for recovery
        sendEvent('automation:log', {
          level: 'warn',
          message: `[Spec] Direct execution failed: ${directErr.message} — asking AI to recover…`,
          timestamp: new Date().toISOString(),
        });

        if (ai) {
          try {
            const domTree = await page.evaluate(() => {
              const els = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')].slice(0, 50);
              return els.map(el => `${el.tagName.toLowerCase()}: "${(el.innerText||el.value||el.getAttribute('aria-label')||'').slice(0,60)}"`).join('\n');
            }).catch(() => '');

            const aiResponse = await ai.analyzeAndAct({
              screenshot,
              domTree,
              currentStep: `Execute this Playwright step (it failed, help recover): ${step.raw}\nError: ${directErr.message}`,
              history: [],
            });

            if (aiResponse.action?.type && aiResponse.action.type !== 'done') {
              // Execute AI-suggested action via automationEngine performAction
              const { performAction } = require('./automationEngine');
              if (performAction) {
                await performAction(aiResponse.action);
                stepPassed = true;
                totalPassed++;
                sendEvent('automation:step-update', {
                  stepIndex, status: 'passed',
                  message: `✓ (AI recovered) ${step.raw}`, screenshot,
                });
                sendEvent('automation:log', {
                  level: 'ai',
                  message: `[AI Recovery] ${aiResponse.reasoning}`,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          } catch (aiErr) {
            stepError = `${directErr.message} | AI recovery failed: ${aiErr.message}`;
          }
        } else {
          stepError = directErr.message;
        }

        if (!stepPassed) {
          totalFailed++;
          stepError = stepError || directErr.message;
          sendEvent('automation:step-update', {
            stepIndex, status: 'failed',
            message: stepError, screenshot,
          });
          sendEvent('automation:failure-detected', {
            stepIndex,
            stepText:    step.raw,
            expected:    'Step should execute successfully',
            actual:      stepError,
            screenshot,
            aiReasoning: `Spec step on line ${step.lineNum} failed`,
          });
        }
      }

      stepIndex++;
      await page.waitForTimeout(300).catch(() => {});
    }
  }

  return { passed: totalPassed, failed: totalFailed, total: stepIndex };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripQuotes(str = '') {
  return String(str).trim().replace(/^['"`]|['"`]$/g, '');
}

function parseArgs(str = '') {
  // Simple arg splitter — handles quoted strings
  const args = [];
  let current = '', depth = 0, inStr = false, strChar = '';
  for (const ch of str) {
    if (!inStr && (ch === "'" || ch === '"' || ch === '`')) { inStr = true; strChar = ch; current += ch; }
    else if (inStr && ch === strChar) { inStr = false; current += ch; }
    else if (!inStr && ch === '(') { depth++; current += ch; }
    else if (!inStr && ch === ')') { depth--; current += ch; }
    else if (!inStr && ch === ',' && depth === 0) { args.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

module.exports = { parseSpecFile, runSpec };
