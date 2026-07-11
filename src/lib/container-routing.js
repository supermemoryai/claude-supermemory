const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseTranscript } = require('./transcript-formatter');
const { validateContainerTag } = require('./validate');

const ROUTING_DIR = path.join(
  os.homedir(),
  '.supermemory-claude',
  'container-routing',
);
const MARKER_PATTERN =
  /<!--\s*supermemory-save-container:\s*([A-Za-z0-9_-]+)\s*-->|<supermemory-save-container>\s*([A-Za-z0-9_-]+)\s*<\/supermemory-save-container>/gi;
const MAX_DESCRIPTION_LENGTH = 240;

function ensureRoutingDir() {
  if (!fs.existsSync(ROUTING_DIR)) {
    fs.mkdirSync(ROUTING_DIR, { recursive: true });
  }
}

function getRoutingFile(sessionId) {
  return path.join(ROUTING_DIR, `${sessionId}.json`);
}

function getAllowedTags(containerTags, fallbackTag) {
  return [
    ...new Set([
      ...containerTags.map((tag) => tag.containerTag).filter(Boolean),
      fallbackTag,
    ]),
  ];
}

function saveContainerRouting(sessionId, containerTags, fallbackTag) {
  if (!sessionId) return;

  ensureRoutingDir();
  fs.writeFileSync(
    getRoutingFile(sessionId),
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        fallbackTag,
        allowedTags: getAllowedTags(containerTags, fallbackTag),
      },
      null,
      2,
    ),
  );
}

function loadContainerRouting(sessionId) {
  if (!sessionId) return null;

  try {
    const file = getRoutingFile(sessionId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function truncateDescription(description) {
  if (!description || typeof description !== 'string') return 'No description';
  const trimmed = description.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= MAX_DESCRIPTION_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH - 3)}...`;
}

function formatContainerTagLine(tag) {
  const parts = [`tag: ${tag.containerTag}`];
  if (tag.name) parts.push(`name: ${tag.name}`);
  parts.push(`description: ${truncateDescription(tag.description)}`);
  if (typeof tag.documentCount === 'number') {
    parts.push(`documents: ${tag.documentCount}`);
  }
  if (typeof tag.memoryCount === 'number') {
    parts.push(`memories: ${tag.memoryCount}`);
  }
  if (tag.visibility) parts.push(`visibility: ${tag.visibility}`);
  return `- ${parts.join(' | ')}`;
}

function buildContainerRoutingPrompt(containerTags, fallbackTag) {
  if (!containerTags.length) return null;

  const lines = containerTags.map(formatContainerTagLine).join('\n');

  return `<supermemory-save-routing>
Choose the best Supermemory container tag for saving this Claude Code session.
In your first assistant response, include this Markdown HTML comment before any visible text:
<!-- supermemory-save-container: <containerTag> -->
Pick exactly one tag from the list. Use the fallback tag only when no listed tag clearly fits.

Available container tags:
${lines}

Fallback tag:
- tag: ${fallbackTag} | description: Current Claude Code project/session memory
</supermemory-save-routing>`;
}

function getAssistantText(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');
}

function findSelectedContainerTag(transcriptPath, allowedTags = []) {
  const allowedSet = new Set(allowedTags.filter(Boolean));
  const entries = parseTranscript(transcriptPath);

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== 'assistant') continue;

    const text = getAssistantText(entry);
    MARKER_PATTERN.lastIndex = 0;

    let match = MARKER_PATTERN.exec(text);
    while (match !== null) {
      const tag = match[1] || match[2];
      const validation = validateContainerTag(tag);
      if (validation.valid && (allowedSet.size === 0 || allowedSet.has(tag))) {
        return tag;
      }
      match = MARKER_PATTERN.exec(text);
    }
  }

  return null;
}

function getSessionContainerTag({ sessionId, transcriptPath, fallbackTag }) {
  const routing = loadContainerRouting(sessionId);
  const selectedTag = findSelectedContainerTag(
    transcriptPath,
    routing?.allowedTags || [],
  );

  return selectedTag || routing?.fallbackTag || fallbackTag;
}

module.exports = {
  buildContainerRoutingPrompt,
  saveContainerRouting,
  loadContainerRouting,
  findSelectedContainerTag,
  getSessionContainerTag,
};
