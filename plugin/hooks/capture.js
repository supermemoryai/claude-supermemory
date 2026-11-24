const {
  addMemory,
  addSession,
  AGENT_SUPPORTING_CONTEXT,
  useV5,
} = require('./lib/api');
const { hasOpeningPrompt, rememberOpeningPrompt } = require('./lib/dedupe');
const { redactSecrets } = require('./lib/redact');
const { readRawChunks, withSessionLock } = require('./lib/session');
const { getSkipReason } = require('./lib/session-scope');
const {
  getNamespace,
  getProjectIdentity,
  getProjectName,
} = require('./lib/container-tag');
const { loadProjectConfig } = require('./lib/project-config');
const {
  loadSettings,
  getAuthToken,
  getBaseUrl,
  getApiVersion,
  debugLog,
  getSignalConfig,
} = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const {
  formatNewEntries,
  formatSignalEntries,
  setLastCapturedUuid,
} = require('./lib/transcript');
const { getUserFriendlyError } = require('./lib/error-helpers');
const { saveLastSession } = require('./lib/last-session');
const {
  clearCaptureNotice,
  readState,
  writeCaptureNotice,
  writeState,
} = require('./lib/session-state');

const CAPTURE_TIMEOUT_MS = 25000;
const MIN_REQUEST_MS = 1000;
const REJECTED_STATUSES = new Set([400, 413, 415, 422]);

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Stop allows 30s; this write outlives the 3s default without slowing SessionStart.
async function main() {
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  const settings = loadSettings();
  let sessionId;
  let notice = '';

  try {
    const input = await readStdin();
    const skipReason = getSkipReason(input, settings);
    if (skipReason) {
      debugLog(settings, 'Supermemory skipped', { reason: skipReason });
      writeOutput({ continue: true });
      return;
    }
    const cwd = input.cwd || process.cwd();
    sessionId = input.session_id;
    const transcriptPath = input.transcript_path;
    const projectConfig = loadProjectConfig(cwd);

    if (!transcriptPath || !sessionId) {
      writeOutput({ continue: true });
      return;
    }

    let apiKey;
    try {
      apiKey = await getAuthToken(cwd, projectConfig);
    } catch {
      writeOutput({ continue: true });
      return;
    }

    const namespace = getNamespace(cwd);
    const baseUrl = getBaseUrl(cwd, projectConfig);
    const apiVersion = getApiVersion(cwd, projectConfig);
    const metadata = {
      type: 'session_turn',
      project: getProjectName(cwd),
      sm_project_id: getProjectIdentity(cwd),
      sm_scope: 'personal',
      sm_capture_mode: 'automatic',
      timestamp: new Date().toISOString(),
    };
    const captured = readState(sessionId, 'capture')?.count || 0;

    if (useV5(baseUrl, { apiVersion }, namespace)) {
      const acquired = await withSessionLock(sessionId, async () => {
        const chunks = readRawChunks(transcriptPath, sessionId, {
          destination: `${baseUrl}\n${namespace}`,
          lastAssistantMessage: input.last_assistant_message,
          captureSubagents: settings.captureSubagents,
        });
        let sent = 0;
        let skippedBytes = 0;
        let truncatedBytes = 0;
        let lastId;
        const skipReasons = new Set();
        for (const chunk of chunks) {
          if (chunk.oversizedBytes > 0) {
            chunk.commit(
              `one transcript line of ${formatBytes(chunk.oversizedBytes)} is too large to send`,
            );
            skippedBytes += chunk.oversizedBytes;
            skipReasons.add('line too large');
            continue;
          }
          if (!chunk.raw) {
            chunk.commit();
            continue;
          }
          const remaining = deadline - Date.now();
          if (remaining < MIN_REQUEST_MS) break;
          if (sent === 0) {
            writeState(sessionId, 'capture', { status: 'saving', count: captured });
          }
          try {
            const result = await addSession(baseUrl, apiKey, namespace, chunk.raw, {
              id: sessionId,
              generation: chunk.generation,
              offset: chunk.offset,
              supportingContext: AGENT_SUPPORTING_CONTEXT,
              metadata,
              apiVersion,
              timeoutMs: remaining,
            });
            chunk.commit();
            sent++;
            truncatedBytes += chunk.truncatedBytes;
            lastId = result.id;
          } catch (err) {
            const status = err?.status ?? err?.statusCode;
            if (!REJECTED_STATUSES.has(status)) throw err;
            const bytes = Buffer.byteLength(chunk.raw);
            chunk.commit(`server rejected ${formatBytes(bytes)} with HTTP ${status}`);
            skippedBytes += bytes;
            skipReasons.add(`HTTP ${status}`);
            debugLog(settings, 'Chunk rejected and skipped', {
              offset: chunk.offset,
              end: chunk.end,
              status,
            });
          }
        }
        if (sent === 0 && skippedBytes === 0) {
          if (chunks.some((chunk) => chunk.raw)) {
            debugLog(settings, 'Capture deadline reached; delta left for the next Stop');
            return;
          }
          writeState(sessionId, 'capture', {
            status: 'no_content',
            count: captured,
          });
          debugLog(settings, 'No new content to save');
          return;
        }
        writeState(sessionId, 'capture', {
          status: sent > 0 ? 'saved' : 'error',
          count: captured + (sent > 0 ? 1 : 0),
        });
        clearCaptureNotice();
        if (lastId) {
          try {
            saveLastSession({ id: lastId, containerTag: namespace });
          } catch {}
        }
        const skippedNote =
          skippedBytes > 0
            ? `skipped ${formatBytes(skippedBytes)} of this session (${[...skipReasons].join(', ')}); ranges listed in ~/.supermemory-claude/session`
            : '';
        if (skippedNote) writeCaptureNotice(skippedNote);
        notice = [
          truncatedBytes > 0
            ? `trimmed ${formatBytes(truncatedBytes)} of oversized tool output`
            : '',
          skippedNote,
        ]
          .filter(Boolean)
          .join(' · ');
        debugLog(settings, 'Session sent', {
          chunks: chunks.length,
          sent,
          skippedBytes,
          truncatedBytes,
        });
      });
      if (!acquired) {
        debugLog(settings, 'Capture lock busy; delta left for the next Stop');
      }
      writeOutput(
        notice
          ? { continue: true, systemMessage: `◪ supermemory · ${notice}` }
          : { continue: true },
      );
      return;
    }

    const dedupeScope = [baseUrl, apiKey, namespace].join('\n');
    const captureOptions = {
      captureSubagents: settings.captureSubagents,
      isKnownOpeningPrompt: settings.dedupeOpeningPrompt
        ? (text) => hasOpeningPrompt(dedupeScope, text)
        : null,
    };
    const delta = getSignalConfig(cwd).enabled
      ? formatSignalEntries(
          transcriptPath,
          sessionId,
          cwd,
          input.last_assistant_message,
          captureOptions,
        )
      : formatNewEntries(
          transcriptPath,
          sessionId,
          cwd,
          input.last_assistant_message,
          captureOptions,
        );

    if (!delta) {
      writeState(sessionId, 'capture', {
        status: 'no_content',
        count: captured,
      });
      debugLog(settings, 'No new content to save');
      writeOutput({ continue: true });
      return;
    }

    writeState(sessionId, 'capture', { status: 'saving', count: captured });

    const result = await addMemory(
      baseUrl,
      apiKey,
      redactSecrets(delta.formatted),
      namespace,
      metadata,
      {
        id: sessionId,
        supportingContext: AGENT_SUPPORTING_CONTEXT,
        apiVersion,
        timeoutMs: CAPTURE_TIMEOUT_MS,
      },
    );

    setLastCapturedUuid(sessionId, delta.lastUuid, delta.pendingReplies);
    if (settings.dedupeOpeningPrompt && delta.openingPrompt) {
      rememberOpeningPrompt(dedupeScope, delta.openingPrompt);
    }
    writeState(sessionId, 'capture', { status: 'saved', count: captured + 1 });
    clearCaptureNotice();

    if (result?.id) {
      try {
        saveLastSession({ id: result.id, containerTag: namespace });
      } catch {}
    }

    debugLog(settings, 'Session turn saved', {
      length: delta.formatted.length,
    });
    writeOutput({ continue: true });
  } catch (err) {
    const status = err?.status ?? err?.statusCode;
    const friendly = redactSecrets(
      getUserFriendlyError(
        typeof status === 'number'
          ? { status, message: `Supermemory API returned HTTP ${status}.` }
          : err,
      ),
    );
    debugLog(settings, 'Capture error', { error: friendly });
    console.error(`Supermemory: ${friendly}`);
    writeCaptureNotice(friendly);
    writeState(sessionId, 'capture', { status: 'error' });
    writeOutput({ continue: true });
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${redactSecrets(err.message)}`);
  process.exit(1);
});
