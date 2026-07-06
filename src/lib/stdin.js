const DEFAULT_STDIN_TIMEOUT_MS = 3000;

async function readStdin(timeoutMs = DEFAULT_STDIN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let data = '';
    let settled = false;
    let timer = null;

    // On Windows, piped stdin never emits 'end' for hook subprocesses, so we
    // must stop stdin from keeping the event loop (and the process) alive
    // once we've settled.
    const releaseStdin = () => {
      try {
        process.stdin.pause();
      } catch {}
      try {
        process.stdin.unref?.();
      } catch {}
    };

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      releaseStdin();
      fn(value);
    };

    // Hooks receive a single JSON object; resolve as soon as it parses so
    // platforms that never emit 'end' don't wait for the timeout.
    const tryParse = () => {
      if (!data.trim()) return;
      try {
        const parsed = JSON.parse(data);
        settle(resolve, parsed);
      } catch {
        // Incomplete JSON; keep accumulating chunks.
      }
    };

    timer = setTimeout(() => {
      settle(resolve, {});
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      tryParse();
    });
    process.stdin.on('end', () => {
      if (settled) return;
      if (!data.trim()) {
        settle(resolve, {});
        return;
      }
      try {
        settle(resolve, JSON.parse(data));
      } catch (err) {
        settle(reject, new Error(`Failed to parse stdin JSON: ${err.message}`));
      }
    });
    process.stdin.on('error', (err) => settle(reject, err));
    if (process.stdin.isTTY) settle(resolve, {});
  });
}

function writeOutput(data) {
  console.log(JSON.stringify(data));
}

function outputSuccess(additionalContext = null) {
  if (additionalContext) {
    writeOutput({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
    });
  } else {
    writeOutput({ continue: true, suppressOutput: true });
  }
}

function outputError(message) {
  console.error(`Supermemory: ${message}`);
  writeOutput({ continue: true, suppressOutput: true });
}

module.exports = { readStdin, writeOutput, outputSuccess, outputError };
