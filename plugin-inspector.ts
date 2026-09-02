import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dir;
const PLUGIN = join(ROOT, 'plugin');

function parseFrontmatter(text: string) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const fm: Record<string, string> = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\S+?):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2];
    }
  }
  return fm;
}

function listFiles(dir: string, prefix = ''): { path: string; size: number }[] {
  const out: { path: string; size: number }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else out.push({ path: rel, size: statSync(join(dir, entry.name)).size });
  }
  return out;
}

async function inspect() {
  const manifest = await Bun.file(
    join(PLUGIN, '.claude-plugin/plugin.json'),
  ).json();
  const hooksJson = (await Bun.file(
    join(PLUGIN, 'hooks/hooks.json'),
  ).json()) as {
    hooks: Record<
      string,
      { matcher?: string; hooks: { command: string; timeout: number }[] }[]
    >;
  };
  const mcpJson = await Bun.file(join(PLUGIN, '.mcp.json')).json();

  const hooks = Object.entries(hooksJson.hooks).flatMap(([event, groups]) =>
    groups.flatMap((g) =>
      g.hooks.map((h) => {
        const script = h.command.match(/hooks\/[\w-]+\.js/)?.[0] ?? '';
        return {
          event,
          matcher: g.matcher ?? '*',
          script,
          timeout: h.timeout,
          exists: script ? statSyncSafe(join(PLUGIN, script)) !== null : false,
        };
      }),
    ),
  );

  const commands = await Promise.all(
    readdirSync(join(PLUGIN, 'commands')).map(async (f) => {
      const content = await Bun.file(join(PLUGIN, 'commands', f)).text();
      const fm = parseFrontmatter(content);
      return {
        name: f.replace('.md', ''),
        description: fm.description ?? '',
        content,
      };
    }),
  );

  const agents = await Promise.all(
    readdirSync(join(PLUGIN, 'agents')).map(async (f) => {
      const content = await Bun.file(join(PLUGIN, 'agents', f)).text();
      const fm = parseFrontmatter(content);
      return {
        name: f.replace('.md', ''),
        description: fm.description ?? '',
        content,
      };
    }),
  );

  const approveSrc = await Bun.file(
    join(PLUGIN, 'hooks/recall-approve.js'),
  ).text();
  const readOnlyTools = [...approveSrc.matchAll(/^\s*'([\w-]+)',$/gm)].map(
    (m) => m[1],
  );

  let git = { branch: 'unknown', commit: 'unknown' };
  try {
    git = {
      branch: (
        await Bun.$`git branch --show-current`.cwd(ROOT).quiet().text()
      ).trim(),
      commit: (
        await Bun.$`git log -1 --format=%h %s`.cwd(ROOT).quiet().text()
      ).trim(),
    };
  } catch {}

  return {
    manifest,
    git,
    mcp: mcpJson,
    hooks,
    commands,
    agents,
    readOnlyTools,
    files: listFiles(PLUGIN),
  };
}

function statSyncSafe(p: string) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Supermemory Plugin Inspector</title>
<style>
  :root { color-scheme: dark; }
  body { font: 14px/1.5 ui-monospace, monospace; background: #0d0d0f; color: #e4e4e7; max-width: 1080px; margin: 2rem auto; padding: 0 1rem 4rem; }
  h1 { font-size: 18px; } h1 small { color: #71717a; font-weight: normal; }
  h2 { font-size: 14px; color: #a1a1aa; border-bottom: 1px solid #27272a; padding-bottom: 4px; margin-top: 2.5rem; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 4px 12px 4px 0; vertical-align: top; border-bottom: 1px solid #1c1c1f; }
  th { color: #71717a; font-weight: normal; }
  .ok { color: #4ade80; } .bad { color: #f87171; }
  .dim { color: #71717a; }
  .badge { background: #1c1c1f; border: 1px solid #27272a; border-radius: 4px; padding: 1px 8px; margin-right: 6px; }
  pre { background: #131316; border: 1px solid #27272a; border-radius: 6px; padding: 12px; overflow-x: auto; white-space: pre-wrap; font-size: 12.5px; }
  details { margin: 6px 0; }
  summary { cursor: pointer; color: #93c5fd; }
  summary .dim { margin-left: 8px; }
</style>
</head>
<body>
<h1>supermemory plugin <small id="meta"></small></h1>
<div id="badges"></div>
<h2>hooks</h2><table id="hooks"></table>
<h2>mcp server + auto-approved (read-only) tools</h2><div id="mcp"></div>
<h2>agents</h2><div id="agents"></div>
<h2>commands</h2><div id="commands"></div>
<h2>plugin files (all committed source, no build)</h2><table id="files"></table>
<script>
const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const kb = n => n < 1024 ? n + ' b' : (n / 1024).toFixed(1) + ' kb';
const HOOK_NOTES = {
  SessionStart: 'profile fetch → context + "N memories loaded" + welcome-back; auth bootstrap; statusline symlink upkeep',
  UserPromptSubmit: 'bounded automatic recall from the active and configured containers',
  PreToolUse: 'auto-approves read-only supermemory MCP tools + "recalling: <query>" message',
  Stop: 'captures transcript delta with entityContext; writes statusline state',
};
fetch('/api/inspect').then(r => r.json()).then(d => {
  document.getElementById('meta').textContent = 'v' + d.manifest.version + ' \\u00b7 ' + d.git.branch + ' \\u00b7 ' + d.git.commit;
  const total = d.files.reduce((a, f) => a + f.size, 0);
  document.getElementById('badges').innerHTML =
    '<span class="badge">' + d.files.length + ' files</span>' +
    '<span class="badge">' + kb(total) + ' total</span>' +
    '<span class="ok">zero dependencies · zero build steps</span>';
  document.getElementById('hooks').innerHTML =
    '<tr><th>event</th><th>matcher</th><th>script</th><th>timeout</th><th>role</th></tr>' +
    d.hooks.map(h => '<tr><td>' + esc(h.event) + '</td><td class="dim">' + esc(h.matcher) + '</td><td class="' +
      (h.exists ? 'ok' : 'bad') + '">' + esc(h.script) + '</td><td class="dim">' + h.timeout + 's</td><td class="dim">' +
      esc(HOOK_NOTES[h.event] || '') + '</td></tr>').join('');
  const server = Object.entries(d.mcp)[0];
  document.getElementById('mcp').innerHTML =
    '<p class="dim">server "' + esc(server[0]) + '": ' + esc(server[1].command + ' ' + server[1].args.join(' ')) +
    ' (proxy \\u2192 mcp.supermemory.ai, authed via credentials.json)</p>' +
    d.readOnlyTools.map(t => '<span class="badge ok">' + esc(t) + '</span>').join('');
  const fileSection = items => items.map(i =>
    '<details><summary>' + esc(i.name) + '<span class="dim">' + esc(i.description) + '</span></summary><pre>' + esc(i.content) + '</pre></details>').join('');
  document.getElementById('agents').innerHTML = fileSection(d.agents);
  document.getElementById('commands').innerHTML = fileSection(d.commands);
  document.getElementById('files').innerHTML =
    '<tr><th>file</th><th>size</th></tr>' +
    d.files.sort((a, b) => a.path.localeCompare(b.path)).map(f =>
      '<tr><td>' + esc(f.path) + '</td><td class="dim">' + kb(f.size) + '</td></tr>').join('');
});
</script>
</body>
</html>`;

const server = Bun.serve({
  port: 4747,
  routes: {
    '/': () => new Response(html, { headers: { 'Content-Type': 'text/html' } }),
    '/api/inspect': async () => Response.json(await inspect()),
  },
});

console.log(`plugin inspector → ${server.url}`);
