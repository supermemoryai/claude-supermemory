const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  getIncludeTools,
  shouldIncludeTool,
  getSignalConfig,
} = require('./settings');
const { compressObservation } = require('./compress');
const TRACKER_DIR = path.join(os.homedir(), '.supermemory-claude', 'trackers');

let toolUseMap = new Map();
let currentIncludeList = [];

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
    } catch {}
  }

  return entries;
}

function getEntriesSinceLastCapture(entries, lastCapturedUuid) {
  if (!lastCapturedUuid) {
    return entries.filter((e) => e.type === 'user' || e.type === 'assistant');
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
      parts.push(`<|start|>user<|message|>${cleaned}<|end|>`);
    }
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        const cleaned = cleanContent(block.text);
        if (cleaned) {
          parts.push(`<|start|>user<|message|>${cleaned}<|end|>`);
        }
      } else if (block.type === 'tool_result') {
        const toolId = block.tool_use_id || '';
        const toolEntry = toolUseMap.get(toolId) || {
          name: 'Unknown',
          input: {},
        };
        const toolName = toolEntry.name;
        if (!shouldIncludeTool(toolName, currentIncludeList)) {
          continue;
        }
        const status = block.is_error ? 'error' : 'success';
        const compressed = compressObservation(toolName, toolEntry.input, {
          error: block.is_error,
          content: block.content,
        });
        const isGeneric = compressed.startsWith('Used ');
        const fallback = truncate(cleanContent(block.content || ''), 500);
        let resultText;
        if (block.is_error && fallback) {
          resultText = `${compressed} | ${fallback}`;
        } else if (isGeneric && fallback) {
          resultText = fallback;
        } else {
          resultText = compressed;
        }
        if (resultText) {
          parts.push(
            `<|start|>assistant:tool_result<|message|>${toolName}(${status}): ${resultText}<|end|>`,
          );
        }
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
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
        parts.push({ type: 'text', content: cleaned });
      }
    } else if (block.type === 'tool_use') {
      const toolName = block.name || 'Unknown';
      const toolId = block.id || '';
      if (toolId) {
        toolUseMap.set(toolId, { name: toolName, input: block.input });
      }
      if (!shouldIncludeTool(toolName, currentIncludeList)) {
        continue;
      }
      const input = block.input || {};
      const inputStr = formatToolInputCompact(input);
      parts.push({ type: 'tool', toolName, inputStr });
    }
  }

  const formatted = parts.map((p) => {
    if (p.type === 'text') {
      return `<|start|>assistant<|message|>${p.content}<|end|>`;
    }
    return `<|start|>assistant:tool<|message|>${p.toolName}: ${p.inputStr}<|end|>`;
  });

  return formatted.length > 0 ? formatted.join('\n') : null;
}

function formatToolInputCompact(input) {
  const parts = [];
  for (const [key, value] of Object.entries(input)) {
    let valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    valueStr = truncate(valueStr, 100);
    parts.push(`${key}="${valueStr}"`);
  }
  return parts.join(' ');
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
  return `${text.slice(0, maxLength)}...`;
}

function getTextFromEntry(entry) {
  if (!entry?.message?.content) return '';

  const content = entry.message.content;

  if (typeof content === 'string') {
    return cleanContent(content);
  }

  if (Array.isArray(content)) {
    const texts = [];
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        texts.push(cleanContent(block.text));
      }
    }
    return texts.join(' ');
  }

  return '';
}

function hasTextContent(entry) {
  if (!entry || entry.isMeta) return false;
  return getTextFromEntry(entry).length > 0;
}

function groupEntriesIntoTurns(entries) {
  const turns = [];
  let currentTurn = { userEntries: [], assistantEntries: [], allEntries: [] };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (entry.type === 'user') {
      if (currentTurn.assistantEntries.length > 0) {
        turns.push(currentTurn);
        currentTurn = { userEntries: [], assistantEntries: [], allEntries: [] };
      }
      currentTurn.userEntries.push(entry);
      currentTurn.allEntries.push(entry);
    } else if (entry.type === 'assistant') {
      currentTurn.assistantEntries.push(entry);
      currentTurn.allEntries.push(entry);
    }
  }

  if (currentTurn.allEntries.length > 0) {
    turns.push(currentTurn);
  }

  return turns;
}

function groupEntriesIntoSignalTurns(entries) {
  const turns = [];
  let currentTurn = { userEntries: [] };
  let lastAssistantEntry = null;

  const pushTurn = () => {
    if (currentTurn.userEntries.length === 0 && !lastAssistantEntry) return;
    const assistantEntries = lastAssistantEntry ? [lastAssistantEntry] : [];
    const allEntries = [...currentTurn.userEntries, ...assistantEntries];
    turns.push({
      userEntries: currentTurn.userEntries,
      assistantEntries,
      allEntries,
    });
    currentTurn = { userEntries: [] };
    lastAssistantEntry = null;
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!hasTextContent(entry)) continue;

    if (entry.type === 'user') {
      if (lastAssistantEntry) {
        pushTurn();
      }
      currentTurn.userEntries.push(entry);
    } else if (entry.type === 'assistant') {
      lastAssistantEntry = entry;
    }
  }

  pushTurn();

  return turns;
}

function getTurnUserText(turn) {
  const texts = [];
  for (const entry of turn.userEntries) {
    const text = getTextFromEntry(entry);
    if (text) texts.push(text);
  }
  return texts.join(' ').toLowerCase();
}

function findSignalTurnIndices(turns, keywords) {
  const signalIndices = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const userText = getTurnUserText(turn);

    for (const keyword of keywords) {
      if (userText.includes(keyword)) {
        signalIndices.push(i);
        break;
      }
    }
  }

  return signalIndices;
}

function getTurnsAroundSignals(turns, signalIndices, turnCount) {
  if (signalIndices.length === 0) return [];

  const includeSet = new Set();

  for (const signalIdx of signalIndices) {
    const startIdx = Math.max(0, signalIdx - (turnCount - 1));
    for (let i = startIdx; i <= signalIdx; i++) {
      includeSet.add(i);
    }
  }

  const sortedIndices = Array.from(includeSet).sort((a, b) => a - b);
  return sortedIndices.map((idx) => turns[idx]);
}

function formatEntryTextOnly(entry) {
  if (entry.type === 'user') {
    return formatUserMessageTextOnly(entry.message);
  }

  if (entry.type === 'assistant') {
    return formatAssistantMessageTextOnly(entry.message);
  }

  return null;
}

function formatUserMessageTextOnly(message) {
  if (!message?.content) return null;

  const content = message.content;
  const parts = [];

  if (typeof content === 'string') {
    const cleaned = cleanContent(content);
    if (cleaned) {
      parts.push(`<|start|>user<|message|>${cleaned}<|end|>`);
    }
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        const cleaned = cleanContent(block.text);
        if (cleaned) {
          parts.push(`<|start|>user<|message|>${cleaned}<|end|>`);
        }
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

function formatAssistantMessageTextOnly(message) {
  if (!message?.content) return null;

  const content = message.content;
  const parts = [];

  if (typeof content === 'string') {
    const cleaned = cleanContent(content);
    if (cleaned) {
      parts.push(`<|start|>assistant<|message|>${cleaned}<|end|>`);
    }
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        const cleaned = cleanContent(block.text);
        if (cleaned) {
          parts.push(`<|start|>assistant<|message|>${cleaned}<|end|>`);
        }
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

function formatSignalEntries(transcriptPath, sessionId, cwd) {
  toolUseMap = new Map();
  currentIncludeList = getIncludeTools(cwd);

  const signalConfig = getSignalConfig(cwd);
  const { keywords, turnsBefore } = signalConfig;

  const entries = parseTranscript(transcriptPath);
  if (entries.length === 0) return null;

  const lastCapturedUuid = getLastCapturedUuid(sessionId);
  const newEntries = getEntriesSinceLastCapture(entries, lastCapturedUuid);

  if (newEntries.length === 0) return null;

  const turns = groupEntriesIntoSignalTurns(newEntries);

  if (turns.length === 0) return null;

  const signalIndices = findSignalTurnIndices(turns, keywords);

  if (signalIndices.length === 0) {
    return null;
  }

  const turnsToFormat = getTurnsAroundSignals(
    turns,
    signalIndices,
    turnsBefore,
  );

  if (turnsToFormat.length === 0) return null;

  const allEntriesToFormat = [];
  for (const turn of turnsToFormat) {
    allEntriesToFormat.push(...turn.allEntries);
  }

  if (allEntriesToFormat.length === 0) return null;

  const firstEntry = allEntriesToFormat[0];
  const lastEntry = newEntries[newEntries.length - 1];
  const timestamp = firstEntry.timestamp || new Date().toISOString();

  const formattedParts = [];

  formattedParts.push(`<|turn_start|>${timestamp}`);

  for (const entry of allEntriesToFormat) {
    const formatted = formatEntryTextOnly(entry);
    if (formatted) {
      formattedParts.push(formatted);
    }
  }

  formattedParts.push('<|turn_end|>');

  const result = formattedParts.join('\n\n');

  if (result.length < 100) return null;

  setLastCapturedUuid(sessionId, lastEntry.uuid);

  return result;
}

function formatNewEntries(transcriptPath, sessionId, cwd) {
  toolUseMap = new Map();
  currentIncludeList = getIncludeTools(cwd);

  const entries = parseTranscript(transcriptPath);
  if (entries.length === 0) return null;

  const lastCapturedUuid = getLastCapturedUuid(sessionId);
  const newEntries = getEntriesSinceLastCapture(entries, lastCapturedUuid);

  if (newEntries.length === 0) return null;

  const firstEntry = newEntries[0];
  const lastEntry = newEntries[newEntries.length - 1];
  const timestamp = firstEntry.timestamp || new Date().toISOString();

  const formattedParts = [];

  formattedParts.push(`<|turn_start|>${timestamp}`);

  for (const entry of newEntries) {
    const formatted = formatEntry(entry);
    if (formatted) {
      formattedParts.push(formatted);
    }
  }

  formattedParts.push('<|turn_end|>');

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
  formatSignalEntries,
  cleanContent,
  getLastCapturedUuid,
  setLastCapturedUuid,
  getTextFromEntry,
  groupEntriesIntoTurns,
  findSignalTurnIndices,
  getTurnsAroundSignals,
};
