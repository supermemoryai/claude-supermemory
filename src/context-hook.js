const { LocalMemoryClient } = require('./lib/local-memory-client');
const {
  getContainerTag,
  getRepoContainerTag,
  getProjectName,
} = require('./lib/container-tag');
const { loadSettings, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { formatContext, combineContexts } = require('./lib/format-context');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const projectName = getProjectName(cwd);

    debugLog(settings, 'SessionStart', { cwd, projectName });

    const client = new LocalMemoryClient();
    const personalTag = getContainerTag(cwd);
    const repoTag = getRepoContainerTag(cwd);

    debugLog(settings, 'Fetching contexts', { personalTag, repoTag });

    const [personalResult, repoResult] = await Promise.all([
      client.getProfile(personalTag, projectName, settings.maxProfileItems).catch(() => null),
      client.getProfile(repoTag, projectName, settings.maxProfileItems).catch(() => null),
    ]);

    const personalContext = formatContext(
      personalResult,
      true,
      false,
      settings.maxProfileItems,
      false,
    );

    const repoContext = formatContext(
      repoResult,
      true,
      false,
      settings.maxProfileItems,
      false,
    );

    const additionalContext = combineContexts([
      { label: '### Personal Memories', content: personalContext },
      {
        label: '### Project Knowledge (Shared across team)',
        content: repoContext,
      },
    ]);

    if (!additionalContext) {
      writeOutput({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `<supermemory-context>
No previous memories found for this project.
Memories will be saved as you work.
</supermemory-context>`,
        },
      });
      return;
    }

    debugLog(settings, 'Context generated', {
      length: additionalContext.length,
      hasPersonal: !!personalContext,
      hasRepo: !!repoContext,
    });

    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    });
  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    console.error(`Supermemory-local: ${err.message}`);
    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `<supermemory-status>
Failed to load memories: ${err.message}
Session will continue without memory context.
</supermemory-status>`,
      },
    });
  }
}

main().catch((err) => {
  console.error(`Supermemory-local fatal: ${err.message}`);
  process.exit(1);
});
