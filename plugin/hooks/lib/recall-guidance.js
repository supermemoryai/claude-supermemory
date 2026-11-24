const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJson } = require('./session-state');

const GUIDANCE_MARKER = 'guidance.json';

function recallGuidance(namespace) {
  return `<supermemory-guide>
Lines marked ◪ come from supermemory: the profile at session start and the <supermemory-recall> blocks added to later prompts. When one shapes your answer, credit it naturally with the ◪ prefix (e.g. "◪ earlier you decided X"); if you name the source, say "from supermemory" — never "from memory". For deeper history, call the supermemory search_memory tool — it defaults to this project's container (${namespace}). Pass containerTag only to search a different space. Or launch the context-gatherer agent.
</supermemory-guide>`;
}

function guidanceSent(sessionDir) {
  return (
    Boolean(sessionDir) && fs.existsSync(path.join(sessionDir, GUIDANCE_MARKER))
  );
}

function markGuidanceSent(sessionDir) {
  if (!sessionDir) return;
  try {
    atomicWriteJson(path.join(sessionDir, GUIDANCE_MARKER), {
      sentAt: new Date().toISOString(),
    });
  } catch {}
}

module.exports = { recallGuidance, guidanceSent, markGuidanceSent };
