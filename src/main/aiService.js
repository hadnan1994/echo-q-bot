/**
 * Echo Q Bot — aiService.js
 *
 * Provider-agnostic AI service layer.
 * Supports: OpenAI (GPT-4o), Anthropic (Claude), Google (Gemini)
 *
 * All providers implement the same interface:
 *   analyzeAndAct({ screenshot, domTree, currentStep, history }) → { action, reasoning, confidence }
 *   ping() → void  (throws on invalid key)
 */

'use strict';

// ── Provider constants ────────────────────────────────────────────────────────
const PROVIDERS = {
  OPENAI:    'openai',
  ANTHROPIC: 'anthropic',
  GEMINI:    'gemini',
  OLLAMA:    'ollama',    // Local Ollama instance
  LOCALAI:   'localai',  // LocalAI / any OpenAI-compatible endpoint
};

const DEFAULT_MODELS = {
  [PROVIDERS.OPENAI]:    'gpt-4o',
  [PROVIDERS.ANTHROPIC]: 'claude-sonnet-4-6',
  [PROVIDERS.GEMINI]:    'gemini-1.5-pro',
  [PROVIDERS.OLLAMA]:    'llava',       // llava is the main vision model for Ollama
  [PROVIDERS.LOCALAI]:   'gpt-4-vision-preview',
};

const DEFAULT_ENDPOINTS = {
  [PROVIDERS.OLLAMA]:  'http://localhost:11434',
  [PROVIDERS.LOCALAI]: 'http://localhost:8080',
};

// ── System prompt (shared across providers) ───────────────────────────────────
const AGENT_SYSTEM_PROMPT = `You are Echo Q Bot, an expert QA automation agent.
You receive a screenshot of a web page, the current DOM structure, and a test step to execute.
Your task is to determine the exact Playwright action needed to complete that step.

RESPONSE FORMAT — always return valid JSON only, no markdown fences:
{
  "action": {
    "type": "click" | "fill" | "select" | "press" | "hover" | "wait" | "assert" | "navigate" | "screenshot" | "done",
    "selector": "CSS selector or ARIA role (for click/fill/select/hover)",
    "value": "text to type or option to select (for fill/select/press)",
    "url": "URL to navigate to (for navigate)",
    "assertion": "what to assert and the expected value (for assert)",
    "timeout": 5000
  },
  "reasoning": "Why you chose this action based on the current step and screenshot",
  "confidence": 0.0-1.0,
  "stepComplete": true | false,
  "issueDetected": null | "description of any anomaly or failure observed"
}

Rules:
- Prefer ARIA roles and accessible names over brittle CSS selectors when possible
- If the step is already visually complete, set stepComplete: true and type: "done"
- If you see an error on screen unrelated to the test, set issueDetected to describe it
- If confidence is below 0.5, use type: "wait" to pause and re-evaluate next cycle
- Never perform destructive actions not described in the test step
- {{variable}} placeholders in steps have already been resolved with CSV data before you receive them
- If you are genuinely unsure which element to interact with, set confidence below 0.4 — the system will ask the human for help`;

// ═══════════════════════════════════════════════════════════════════════════════
// AIService class
// ═══════════════════════════════════════════════════════════════════════════════

class AIService {
  /**
   * @param {object} opts
   * @param {string} opts.provider  - 'openai' | 'anthropic' | 'gemini'
   * @param {string} opts.model     - model string, falls back to default
   * @param {string} opts.apiKey    - raw API key
   */
  constructor({ provider, model, apiKey, endpoint }) {
    this.provider = (provider ?? PROVIDERS.OPENAI).toLowerCase();
    this.model    = model ?? DEFAULT_MODELS[this.provider] ?? DEFAULT_MODELS[PROVIDERS.OPENAI];
    this.apiKey   = apiKey || 'local'; // local providers don't need a real key
    this.endpoint = endpoint || DEFAULT_ENDPOINTS[this.provider] || null;

    // Local providers don't require an API key
    const isLocal = [PROVIDERS.OLLAMA, PROVIDERS.LOCALAI].includes(this.provider);
    if (!isLocal && (!this.apiKey || this.apiKey === 'local')) {
      throw new Error(`AIService: No API key provided for provider '${this.provider}'`);
    }
    this._validateProvider();
  }

  _validateProvider() {
    if (!Object.values(PROVIDERS).includes(this.provider)) {
      throw new Error(`AIService: Unknown provider '${this.provider}'. Must be one of: ${Object.values(PROVIDERS).join(', ')}`);
    }
  }

  _getEndpoint() {
    // For local providers, use the custom endpoint or fall back to default
    return this.endpoint || DEFAULT_ENDPOINTS[this.provider] || null;
  }

  // ── Public interface ──────────────────────────────────────────────────────

  /**
   * Core agentic analysis call.
   * Sends screenshot + DOM + current step to the LLM and returns a structured action.
   *
   * @param {object} opts
   * @param {string} opts.screenshot   - base64 PNG dataURL
   * @param {string} opts.domTree      - simplified DOM snapshot (text)
   * @param {string} opts.currentStep  - the Gherkin/Xray step text to execute
   * @param {Array}  opts.history      - previous { step, action, result } entries
   * @returns {Promise<object>}        - parsed action JSON
   */
  async analyzeAndAct({ screenshot, domTree, currentStep, history = [] }) {
    const userContent = this._buildUserContent({ screenshot, domTree, currentStep, history });

    switch (this.provider) {
      case PROVIDERS.OPENAI:    return this._callOpenAI(userContent);
      case PROVIDERS.ANTHROPIC: return this._callAnthropic(userContent);
      case PROVIDERS.GEMINI:    return this._callGemini(userContent);
      case PROVIDERS.OLLAMA:    return this._callOllama(userContent);
      case PROVIDERS.LOCALAI:   return this._callLocalAI(userContent);
    }
  }

  /**
   * Lightweight ping to validate the key works.
   */
  async ping() {
    switch (this.provider) {
      case PROVIDERS.OPENAI:    return this._pingOpenAI();
      case PROVIDERS.ANTHROPIC: return this._pingAnthropic();
      case PROVIDERS.GEMINI:    return this._pingGemini();
      case PROVIDERS.OLLAMA:    return this._pingOllama();
      case PROVIDERS.LOCALAI:   return this._pingLocalAI();
    }
  }

  // ── Content builders ──────────────────────────────────────────────────────

  _buildUserContent({ screenshot, domTree, currentStep, history }) {
    const historyText = history.length
      ? history.slice(-3).map((h, i) =>
          `Step ${i+1}: "${h.step}"\nAction taken: ${JSON.stringify(h.action)}\nResult: ${h.result}`
        ).join('\n\n')
      : 'None (first step)';

    return {
      text: `CURRENT TEST STEP TO EXECUTE:
"${currentStep}"

RECENT HISTORY:
${historyText}

DOM TREE SNAPSHOT (relevant elements):
${domTree?.slice(0, 3000) ?? '(not available)'}

Please analyze the screenshot and DOM, then return the JSON action to execute this step.`,
      screenshot, // base64 PNG
    };
  }

  // ── OpenAI ────────────────────────────────────────────────────────────────

  async _callOpenAI(content) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey });

    const messages = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          ...(content.screenshot ? [{
            type: 'image_url',
            image_url: { url: content.screenshot, detail: 'high' },
          }] : []),
          { type: 'text', text: content.text },
        ],
      },
    ];

    const response = await client.chat.completions.create({
      model:           this.model,
      max_tokens:      600,
      temperature:     0.1,
      response_format: { type: 'json_object' },
      messages,
    });

    return this._parseResponse(response.choices[0]?.message?.content);
  }

  async _pingOpenAI() {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey });
    await client.models.list();
  }

  // ── Anthropic ─────────────────────────────────────────────────────────────

  async _callAnthropic(content) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client    = new Anthropic({ apiKey: this.apiKey });

    const userContent = [
      ...(content.screenshot ? [{
        type:   'image',
        source: { type: 'base64', media_type: 'image/png', data: content.screenshot.replace(/^data:image\/png;base64,/, '') },
      }] : []),
      { type: 'text', text: content.text },
    ];

    const response = await client.messages.create({
      model:      this.model,
      max_tokens: 600,
      system:     AGENT_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userContent }],
    });

    return this._parseResponse(response.content[0]?.text);
  }

  async _pingAnthropic() {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client    = new Anthropic({ apiKey: this.apiKey });
    await client.messages.create({
      model: this.model, max_tokens: 5,
      messages: [{ role: 'user', content: 'ping' }],
    });
  }

  // ── Gemini ────────────────────────────────────────────────────────────────

  async _callGemini(content) {
    // Gemini via REST API (no official Node SDK for vision at time of writing)
    const axios = require('axios');

    const parts = [{ text: content.text }];
    if (content.screenshot) {
      parts.unshift({
        inlineData: {
          mimeType: 'image/png',
          data:     content.screenshot.replace(/^data:image\/png;base64,/, ''),
        },
      });
    }

    const systemInstruction = { role: 'model', parts: [{ text: AGENT_SYSTEM_PROMPT }] };

    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        system_instruction: systemInstruction,
        contents:           [{ role: 'user', parts }],
        generationConfig:   { temperature: 0.1, maxOutputTokens: 600, responseMimeType: 'application/json' },
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    return this._parseResponse(text);
  }

  async _pingGemini() {
    const axios = require('axios');
    await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`
    );
  }

  // ── Ollama (local) ───────────────────────────────────────────────────────────

  async _callOllama(content) {
    const axios    = require('axios');
    const endpoint = this._getEndpoint();
    const url      = `${endpoint}/api/chat`;

    const messages = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      {
        role:    'user',
        content: content.screenshot
          ? [
              // Ollama vision: images as base64 array
              { type: 'text', text: content.text },
            ]
          : content.text,
        // Ollama passes images separately
        images: content.screenshot
          ? [content.screenshot.replace(/^data:image\/[a-z]+;base64,/, '')]
          : undefined,
      },
    ];

    const res = await axios.post(url, {
      model:    this.model,
      messages,
      stream:   false,
      format:   'json',
      options:  { temperature: 0.1, num_predict: 600 },
    }, {
      headers:  { 'Content-Type': 'application/json' },
      timeout:  60000, // local models can be slow
    });

    const text = res.data?.message?.content || res.data?.response || '';
    return this._parseResponse(text);
  }

  async _pingOllama() {
    const axios    = require('axios');
    const endpoint = this._getEndpoint();
    // Just check the Ollama API is running
    await axios.get(`${endpoint}/api/tags`, { timeout: 5000 });
  }

  // ── LocalAI / OpenAI-compatible endpoint ─────────────────────────────────────
  // Works with: LocalAI, LM Studio, Kobold, text-generation-webui, Jan, etc.

  async _callLocalAI(content) {
    const axios    = require('axios');
    const endpoint = this._getEndpoint();
    const url      = `${endpoint}/v1/chat/completions`;

    const userContent = content.screenshot
      ? [
          { type: 'image_url', image_url: { url: content.screenshot } },
          { type: 'text', text: content.text },
        ]
      : content.text;

    const res = await axios.post(url, {
      model:       this.model,
      max_tokens:  600,
      temperature: 0.1,
      messages: [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        { role: 'user',   content: userContent },
      ],
    }, {
      headers: {
        'Content-Type':  'application/json',
        // Some local endpoints need a dummy auth header
        'Authorization': `Bearer ${this.apiKey === 'local' ? 'local' : this.apiKey}`,
      },
      timeout: 120000,
    });

    const text = res.data?.choices?.[0]?.message?.content || '';
    return this._parseResponse(text);
  }

  async _pingLocalAI() {
    const axios    = require('axios');
    const endpoint = this._getEndpoint();
    await axios.get(`${endpoint}/v1/models`, {
      headers: { Authorization: `Bearer ${this.apiKey === 'local' ? 'local' : this.apiKey}` },
      timeout: 5000,
    });
  }

  // ── Response parser ───────────────────────────────────────────────────────

  _parseResponse(rawText) {
    if (!rawText) throw new Error('AIService: Empty response from LLM');
    try {
      const clean = rawText.replace(/```json\n?|```\n?/g, '').trim();
      const parsed = JSON.parse(clean);
      // Validate required fields
      if (!parsed.action?.type) {
        throw new Error('Response missing required field: action.type');
      }
      return parsed;
    } catch (err) {
      throw new Error(`AIService: Failed to parse LLM response — ${err.message}\nRaw: ${rawText?.slice(0, 200)}`);
    }
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = { AIService, PROVIDERS, DEFAULT_MODELS };
