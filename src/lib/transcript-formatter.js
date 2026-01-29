const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_TOOL_RESULT_LENGTH = 500;
const SKIP_RESULT_TOOLS = ['Read'];
const TRACKER_DIR = path.join(os.homedir(), '.supermemory-claude', 'trackers');

let toolUseMap = new Map();

function ensureTrackerDir() {
  if (!fs.existsSync(TRACKER_DIR)) {
    fs.mkdirSync(TRACKER_DIR, { recursive: true });
  }
}

function getLastCapturedUuid(sessionId) {
  ensureTrackerDir();
  const trackerFile = path.join(TRACKER_DIR, `${sessionId}.txt`);
  if (fs.existsSync(trackerFile)) {
    return fs.readFileSync(trackerFile, 'utf-8').trim();
  }
  return null;
}

function setLastCapturedUuid(sessionId, uuid) {
  ensureTrackerDir();
  const trackerFile = path.join(TRACKER_DIR, `${sessionId}.txt`);
  fs.writeFileSync(trackerFile, uuid);
}

function parseTranscript(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) {
    return [];
  }

  const content = fs.readFileSync(transcriptPath, 'utf-8');
  const lines = content.trim().split('\n');
  const entries = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
    }
  }

  return entries;
}

function getEntriesSinceLastCapture(entries, lastCapturedUuid) {
  if (!lastCapturedUuid) {
    return entries.filter(e => e.type === 'user' || e.type === 'assistant');
  }

  let foundLast = false;
  const newEntries = [];

  for (const entry of entries) {
    if (entry.uuid === lastCapturedUuid) {
      foundLast = true;
      continue;
    }
    if (foundLast && (entry.type === 'user' || entry.type === 'assistant')) {
      newEntries.push(entry);
    }
  }

  return newEntries;
}

function formatEntry(entry) {
  const parts = [];

  if (entry.type === 'user') {
    const formatted = formatUserMessage(entry.message);
    if (formatted) parts.push(formatted);
  } else if (entry.type === 'assistant') {
    const formatted = formatAssistantMessage(entry.message);
    if (formatted) parts.push(formatted);
  }

  return parts.join('\n');
}

function formatUserMessage(message) {
  if (!message?.content) return null;

  const content = message.content;
  const parts = [];

  if (typeof content === 'string') {
    const cleaned = cleanContent(content);
    if (cleaned) {
      parts.push(`[role:user]\n${cleaned}\n[user:end]`);
    }
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        const cleaned = cleanContent(block.text);
        if (cleaned) {
          parts.push(`[role:user]\n${cleaned}\n[user:end]`);
        }
      } else if (block.type === 'tool_result') {
        const toolId = block.tool_use_id || '';
        const toolName = toolUseMap.get(toolId) || 'Unknown';
        if (SKIP_RESULT_TOOLS.includes(toolName)) {
          continue;
        }
        const resultContent = truncate(cleanContent(block.content || ''), MAX_TOOL_RESULT_LENGTH);
        const status = block.is_error ? 'error' : 'success';
        if (resultContent) {
          parts.push(`[tool_result:${toolName} status="${status}"]\n${resultContent}\n[tool_result:end]`);
        }
      }
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function formatAssistantMessage(message) {
  if (!message?.content) return null;

  const content = message.content;
  const parts = [];

  if (!Array.isArray(content)) return null;

  for (const block of content) {
    if (block.type === 'thinking') continue;

    if (block.type === 'text' && block.text) {
      const cleaned = cleanContent(block.text);
      if (cleaned) {
        parts.push(`[role:assistant]\n${cleaned}\n[assistant:end]`);
      }
    } else if (block.type === 'tool_use') {
      const toolName = block.name || 'Unknown';
      const toolId = block.id || '';
      const input = block.input || {};
      const inputLines = formatToolInput(input);
      parts.push(`[tool:${toolName}]\n${inputLines}\n[tool:end]`);
      if (toolId) {
        toolUseMap.set(toolId, toolName);
      }
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function formatToolInput(input) {
  const lines = [];
  for (const [key, value] of Object.entries(input)) {
    let valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    valueStr = truncate(valueStr, 200);
    lines.push(`${key}: ${valueStr}`);
  }
  return lines.join('\n');
}

function cleanContent(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<supermemory-context>[\s\S]*?<\/supermemory-context>/g, '')
    .trim();
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

function formatNewEntries(transcriptPath, sessionId) {
  toolUseMap = new Map();

  const entries = parseTranscript(transcriptPath);
  if (entries.length === 0) return null;

  const lastCapturedUuid = getLastCapturedUuid(sessionId);
  const newEntries = getEntriesSinceLastCapture(entries, lastCapturedUuid);

  if (newEntries.length === 0) return null;

  const firstEntry = newEntries[0];
  const lastEntry = newEntries[newEntries.length - 1];
  const timestamp = firstEntry.timestamp || new Date().toISOString();

  const formattedParts = [];

  formattedParts.push(`[turn:start timestamp="${timestamp}"]`);

  for (const entry of newEntries) {
    const formatted = formatEntry(entry);
    if (formatted) {
      formattedParts.push(formatted);
    }
  }

  formattedParts.push('[turn:end]');

  const result = formattedParts.join('\n\n');

  if (result.length < 100) return null;

  setLastCapturedUuid(sessionId, lastEntry.uuid);

  return result;
}

module.exports = {
  parseTranscript,
  getEntriesSinceLastCapture,
  formatEntry,
  formatNewEntries,
  cleanContent,
  truncate,
  getLastCapturedUuid,
  setLastCapturedUuid
};
