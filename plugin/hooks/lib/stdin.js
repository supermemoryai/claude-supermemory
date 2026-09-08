// Resolves as soon as the accumulated data parses as complete JSON instead of
// waiting for the stream to end: on Windows the stdin 'end' event never fires
// for hook subprocesses (issue #25), which hung every hook for its full
// timeout. A fallback timer resolves with whatever arrived.
const STDIN_TIMEOUT_MS = 3000;

async function readStdin(timeoutMs = STDIN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let data = '';
    let settled = false;
    let timer;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        process.stdin.pause();
        process.stdin.unref?.();
      } catch {}
      callback(value);
    };

    const parse = (final) => {
      const value = data.trim();
      if (!value) {
        if (final) finish(resolve, {});
        return;
      }
      try {
        finish(resolve, JSON.parse(value));
      } catch (err) {
        if (final) {
          finish(
            reject,
            new Error(`Failed to parse stdin JSON: ${err.message}`),
          );
        }
      }
    };

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      parse(false);
    });
    process.stdin.on('end', () => parse(true));
    process.stdin.on('error', (err) => finish(reject, err));

    if (process.stdin.isTTY) {
      finish(resolve, {});
      return;
    }
    timer = setTimeout(() => parse(true), timeoutMs);
    timer.unref?.();
  });
}

function writeOutput(data) {
  console.log(JSON.stringify(data));
}

module.exports = { readStdin, writeOutput };
