const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings, getApiKey, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { startAuthFlow } = require('./lib/auth');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);

    debugLog(settings, 'SessionStart', { cwd, containerTag, projectName });

    let apiKey;
    try {
      apiKey = getApiKey(settings);
    } catch {
      try {
        debugLog(settings, 'No API key found, starting browser auth flow');
        apiKey = await startAuthFlow();
        debugLog(settings, 'Auth flow completed successfully');
      } catch (authErr) {
        const isTimeout = authErr.message === 'AUTH_TIMEOUT';
        writeOutput({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `<supermemory-status>
${isTimeout ? 'Authentication timed out. Please complete login in the browser window.' : 'Authentication failed.'}
If the browser did not open, visit: https://console.supermemory.ai/auth/connect
Or set SUPERMEMORY_CC_API_KEY environment variable manually.
</supermemory-status>`
          }
        });
        return;
      }
    }

    const client = new SupermemoryClient(apiKey);
    const [profileResult, memoriesResult] = await Promise.allSettled([
      client.getProfile(containerTag, projectName),
      client.listMemories(containerTag, settings.maxProjectMemories)
    ]);

    const parts = [`<supermemory-context project="${projectName}">`];

    if (profileResult.status === 'fulfilled' && profileResult.value?.profile) {
      const profile = profileResult.value.profile;
      if (profile.static?.length > 0) {
        parts.push('\n## User Preferences');
        profile.static.slice(0, settings.maxProfileItems).forEach(fact => parts.push(`- ${fact}`));
      }
      if (profile.dynamic?.length > 0) {
        parts.push('\n## Recent Context');
        profile.dynamic.slice(0, settings.maxProfileItems).forEach(fact => parts.push(`- ${fact}`));
      }
    }

    if (memoriesResult.status === 'fulfilled' && memoriesResult.value?.memories) {
      const memories = memoriesResult.value.memories;
      if (memories.length > 0) {
        parts.push('\n## Project Knowledge');
        memories.slice(0, settings.maxContextMemories).forEach(mem => {
          const summary = mem.summary || mem.content || '';
          if (summary) parts.push(`- ${summary.slice(0, 200)}`);
        });
      }
    }

    if (parts.length === 1) {
      parts.push('\nNo previous memories found for this project.');
      parts.push('Memories will be saved as you work.');
    }

    parts.push('\n</supermemory-context>');
    const additionalContext = parts.join('\n');
    debugLog(settings, 'Context generated', { length: additionalContext.length });
    writeOutput({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } });

  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    console.error(`Supermemory: ${err.message}`);
    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `<supermemory-status>
Failed to load memories: ${err.message}
Session will continue without memory context.
</supermemory-status>`
      }
    });
  }
}

main().catch(err => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
