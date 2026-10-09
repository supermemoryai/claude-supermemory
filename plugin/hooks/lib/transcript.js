const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { atomicWriteJson } = require('./session-state');
const {
  getIncludeTools,
  shouldIncludeTool,
  getSignalConfig,
} = require('./settings');

const MAX_TOOL_RESULT_LENGTH = 500;
const TRACKER_DIR = path.join(os.homedir(), '.supermemory-claude', 'trackers');

let toolUseMap = new Map();
let currentIncludeList = [];

function ensureTrackerDir() {
  if (!fs.existsSync(TRACKER_DIR)) {
    fs.mkdirSync(TRACKER_DIR, { recursive: true });
  }
}

function readCaptureTracker(sessionId) {
  ensureTrackerDir();
  try {
    const state = JSON.parse(
      fs.readFileSync(path.join(TRACKER_DIR, `${sessionId}.json`), 'utf8'),
    );
    if (
      typeof state.lastUuid === 'string' &&
      Array.isArray(state.pendingReplies)
    ) {
      return {
        lastUuid: state.lastUuid,
        pendingReplies: state.pendingReplies.filter(
          (reply) =>
            typeof reply?.afterUuid === 'string' &&
            typeof reply.hash === 'string',
        ),
      };
    }
  } catch {}
  const trackerFile = path.join(TRACKER_DIR, `${sessionId}.txt`);
  const lastUuid = fs.existsSync(trackerFile)
    ? fs.readFileSync(trackerFile, 'utf8').trim()
    : null;
  return { lastUuid, pendingReplies: [] };
}

function getLastCapturedUuid(sessionId) {
  return readCaptureTracker(sessionId).lastUuid;
}

function setLastCapturedUuid(sessionId, uuid, pendingReplies = []) {
  ensureTrackerDir();
  const trackerFile = path.join(TRACKER_DIR, `${sessionId}.txt`);
  atomicWriteJson(path.join(TRACKER_DIR, `${sessionId}.json`), {
    lastUuid: uuid,
    pendingReplies,
  });
  const temporary = path.join(
    TRACKER_DIR,
    `.${sessionId}.txt.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, uuid, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporary, trackerFile);
  } catch {} finally {
    try {
      fs.unlinkSync(temporary);
    } catch {}
  }
}

function getAssistantReplyText(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') return cleanContent(content);
  if (!Array.isArray(content)) return '';
  if (content.some((block) => block.type === 'tool_use')) return '';
  return content
    .filter((block) => block.type === 'text')
    .map((block) => cleanContent(block.text))
    .join('\n');
}

function prepareCapture(transcriptPath, sessionId, lastAssistantMessage) {
  const entries = parseTranscript(transcriptPath);
  const tracker = readCaptureTracker(sessionId);
  const lastCapturedUuid = tracker.lastUuid;
  let pendingReplies = tracker.pendingReplies;

  const replyHash = (text) => createHash('sha256').update(text).digest('hex');
  const capturedUuids = new Set();
  pendingReplies = pendingReplies.filter((reply) => {
    const anchor = reply.afterUuid
      ? entries.findIndex((entry) => entry.uuid === reply.afterUuid)
      : -1;
    if (reply.afterUuid && anchor === -1) return true;
    const candidates = entries.slice(anchor + 1);
    for (const entry of candidates) {
      if (reply.afterUuid && entry.type === 'user' && hasTextContent(entry))
        break;
      if (
        entry.type === 'assistant' &&
        replyHash(getAssistantReplyText(entry)) === reply.hash
      ) {
        capturedUuids.add(entry.uuid);
        return false;
      }
    }
    return true;
  });

  const newEntries = getEntriesSinceLastCapture(entries, lastCapturedUuid);
  const lastUuid = newEntries.at(-1)?.uuid || lastCapturedUuid || '';
  const conversational = entries.filter(
    (entry) => entry.type === 'user' || entry.type === 'assistant',
  );
  const lastEntry = conversational.at(-1);
  const finalText = cleanContent(lastAssistantMessage);
  const alreadyFlushed =
    lastEntry?.type === 'assistant' &&
    getAssistantReplyText(lastEntry) === finalText;
  const alreadyCaptured = pendingReplies.some(
    (reply) =>
      reply.afterUuid === lastUuid && reply.hash === replyHash(finalText),
  );
  const uncapturedEntries = newEntries.filter(
    (entry) => !capturedUuids.has(entry.uuid),
  );

  if (finalText && !alreadyFlushed && !alreadyCaptured) {
    uncapturedEntries.push({
      type: 'assistant',
      message: { content: [{ type: 'text', text: lastAssistantMessage }] },
    });
    pendingReplies.push({ afterUuid: lastUuid, hash: replyHash(finalText) });
  }

  return { newEntries: uncapturedEntries, lastUuid, pendingReplies };
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

// A missing tracker is a pre-install session; the whole history must not be uploaded.
function getEntriesSinceLastCapture(entries, lastCapturedUuid) {
  if (!lastCapturedUuid) {
    const conversational = entries.filter(
      (e) => e.type === 'user' || e.type === 'assistant',
    );
    const turns = groupEntriesIntoTurns(conversational);
    return turns.length > 0 ? turns[turns.length - 1].allEntries : [];
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
        const toolName = toolUseMap.get(toolId) || 'Unknown';
        if (!shouldIncludeTool(toolName, currentIncludeList)) {
          continue;
        }
        const resultContent = truncate(
          cleanContent(block.content || ''),
          MAX_TOOL_RESULT_LENGTH,
        );
        const status = block.is_error ? 'error' : 'success';
        if (resultContent) {
          parts.push(
            `<|start|>assistant:tool_result<|message|>${toolName}(${status}): ${resultContent}<|end|>`,
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
        toolUseMap.set(toolId, toolName);
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

function formatSignalEntries(
  transcriptPath,
  sessionId,
  cwd,
  lastAssistantMessage,
) {
  toolUseMap = new Map();
  currentIncludeList = getIncludeTools(cwd);

  const signalConfig = getSignalConfig(cwd);
  const { keywords, turnsBefore } = signalConfig;

  const { newEntries, lastUuid, pendingReplies } = prepareCapture(
    transcriptPath,
    sessionId,
    lastAssistantMessage,
  );

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

  return { formatted: result, lastUuid, pendingReplies };
}

function formatNewEntries(
  transcriptPath,
  sessionId,
  cwd,
  lastAssistantMessage,
) {
  toolUseMap = new Map();
  currentIncludeList = getIncludeTools(cwd);

  const { newEntries, lastUuid, pendingReplies } = prepareCapture(
    transcriptPath,
    sessionId,
    lastAssistantMessage,
  );

  if (newEntries.length === 0) return null;

  const firstEntry = newEntries[0];
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

  return { formatted: result, lastUuid, pendingReplies };
}

module.exports = {
  parseTranscript,
  getEntriesSinceLastCapture,
  formatEntry,
  formatNewEntries,
  formatSignalEntries,
  cleanContent,
  truncate,
  getLastCapturedUuid,
  setLastCapturedUuid,
  getTextFromEntry,
  groupEntriesIntoTurns,
  findSignalTurnIndices,
  getTurnsAroundSignals,
};
