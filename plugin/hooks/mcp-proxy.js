#!/usr/bin/env node
// Bridges Claude Code's stdio MCP transport to the hosted Supermemory MCP
// server, authenticating with the same credentials file the hooks use — one
// browser login covers both. Messages are forwarded sequentially to preserve
// JSON-RPC ordering; SSE responses are unwrapped back into stdout lines.
const readline = require('node:readline');
const { getApiKey } = require('./lib/settings');

const MCP_URL =
  process.env.SUPERMEMORY_MCP_URL || 'https://mcp.supermemory.ai/mcp';
const REQUEST_TIMEOUT_MS = 30000;

let sessionId = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendError(id, code, message) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function emitSseData(text) {
  for (const event of text.split('\n\n')) {
    for (const line of event.split('\n')) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data) process.stdout.write(`${data}\n`);
      }
    }
  }
}

async function forward(message, apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const newSessionId = response.headers.get('mcp-session-id');
  if (newSessionId) sessionId = newSessionId;

  if (response.status === 202) return;
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    sendError(
      message.id,
      -32000,
      `Supermemory MCP ${response.status}: ${text.slice(0, 200) || 'request failed'}`,
    );
    return;
  }

  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  if (!body.trim()) return;

  if (contentType.includes('text/event-stream')) {
    emitSseData(body);
  } else {
    process.stdout.write(`${body.trim()}\n`);
  }
}

async function main() {
  let apiKey = null;
  let keyError = null;
  try {
    apiKey = getApiKey(process.cwd());
  } catch (err) {
    keyError = err;
  }

  let queue = Promise.resolve();
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    queue = queue.then(async () => {
      if (keyError) {
        sendError(
          message.id,
          -32001,
          'Supermemory is not authenticated. Start a Claude Code session with the supermemory plugin to log in, or set SUPERMEMORY_CC_API_KEY.',
        );
        return;
      }
      try {
        await forward(message, apiKey);
      } catch (err) {
        sendError(
          message.id,
          -32000,
          `Supermemory MCP proxy error: ${err.message}`,
        );
      }
    });
  });

  rl.on('close', () => {
    queue.then(() => process.exit(0));
  });
}

main();
