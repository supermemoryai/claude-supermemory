// Generated from supermemoryai/mono packages/agent-config @ 760d32086. Do not edit; run npm run build:agent-config.
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../mono-agent-config-oauth/packages/agent-config/index.ts
var index_exports = {};
__export(index_exports, {
  AGENT_IDS: () => AGENT_IDS,
  appendProjectRule: () => appendProjectRule,
  clearRepoCache: () => clearRepoCache,
  describePluginLogin: () => describePluginLogin,
  findHeldKey: () => findHeldKey,
  getRepoContext: () => getRepoContext,
  getUserDir: () => getUserDir,
  listHeldKeys: () => listHeldKeys,
  listOAuthOrgs: () => listOAuthOrgs,
  newOAuthStore: () => newOAuthStore,
  normalizeGitRemote: () => normalizeGitRemote,
  oauthTokensFor: () => oauthTokensFor,
  orgIdFromAccessToken: () => orgIdFromAccessToken,
  orgIdFromApiKey: () => orgIdFromApiKey,
  planRepoBinding: () => planRepoBinding,
  pluginCredentialsPath: () => pluginCredentialsPath,
  readCredentialsFile: () => readCredentialsFile,
  readPluginApiKey: () => readPluginApiKey,
  readRoutingConfig: () => readRoutingConfig,
  readTeamMarker: () => readTeamMarker,
  resolveAgentConfig: () => resolveAgentConfig,
  routeOrganization: () => routeOrganization,
  upgradeOAuthStore: () => upgradeOAuthStore,
  withDefaultOAuthOrg: () => withDefaultOAuthOrg,
  withDefaultOrganization: () => withDefaultOrganization,
  withOAuthTokens: () => withOAuthTokens,
  withOrganization: () => withOrganization,
  withRejectedKey: () => withRejectedKey,
  withRejectedOAuthOrg: () => withRejectedOAuthOrg,
  withoutAnyOAuthTokens: () => withoutAnyOAuthTokens,
  withoutOAuthOrg: () => withoutOAuthOrg,
  withoutOrganization: () => withoutOrganization
});
module.exports = __toCommonJS(index_exports);

// ../mono-agent-config-oauth/packages/agent-config/credentials.ts
function orgIdFromApiKey(apiKey) {
  if (!apiKey.startsWith("sm_")) return void 0;
  const parts = apiKey.split("_");
  return parts.length >= 3 && parts[1] ? parts[1] : void 0;
}
function listHeldKeys(credentials) {
  if (!credentials) return [];
  const defaultOrgId = credentials.orgId ?? orgIdFromApiKey(credentials.apiKey) ?? null;
  const keys = /* @__PURE__ */ new Map();
  for (const [orgId, entry] of Object.entries(
    credentials.organizations ?? {}
  )) {
    if (!entry?.apiKey) continue;
    keys.set(orgId, {
      orgId,
      apiKey: entry.apiKey,
      name: entry.name,
      slug: entry.slug,
      isDefault: orgId === defaultOrgId,
      rejected: !!entry.rejectedAt
    });
  }
  if (credentials.apiKey && defaultOrgId) {
    const existing = keys.get(defaultOrgId);
    const stored = credentials.organizations?.[defaultOrgId];
    keys.set(defaultOrgId, {
      orgId: defaultOrgId,
      apiKey: credentials.apiKey,
      name: existing?.name,
      slug: existing?.slug,
      isDefault: true,
      rejected: !!stored?.rejectedAt && stored.apiKey === credentials.apiKey
    });
  }
  return [...keys.values()];
}
function withOrganization(credentials, entry, makeDefault) {
  const { orgId, ...stored } = entry;
  const organizations = { ...credentials?.organizations ?? {} };
  if (credentials?.apiKey) {
    const currentOrgId = credentials.orgId ?? orgIdFromApiKey(credentials.apiKey);
    if (currentOrgId && !organizations[currentOrgId]) {
      organizations[currentOrgId] = {
        apiKey: credentials.apiKey,
        method: credentials.method,
        createdAt: credentials.createdAt
      };
    }
  }
  organizations[orgId] = stored;
  const isCurrentDefault = !!credentials?.apiKey && (credentials.orgId ?? orgIdFromApiKey(credentials.apiKey)) === orgId;
  if (makeDefault || isCurrentDefault || !credentials?.apiKey) {
    return {
      apiKey: stored.apiKey,
      method: stored.method,
      orgId,
      createdAt: stored.createdAt,
      organizations
    };
  }
  return { ...credentials, organizations };
}
function withoutOrganization(credentials, orgId) {
  const organizations = { ...credentials.organizations ?? {} };
  delete organizations[orgId];
  const defaultOrgId = credentials.orgId ?? orgIdFromApiKey(credentials.apiKey);
  if (defaultOrgId !== orgId) return { ...credentials, organizations };
  const [nextOrgId, next] = Object.entries(organizations)[0] ?? [];
  if (!nextOrgId || !next) return null;
  return {
    apiKey: next.apiKey,
    method: next.method,
    orgId: nextOrgId,
    createdAt: next.createdAt,
    organizations
  };
}
function withDefaultOrganization(credentials, orgId) {
  const target = listHeldKeys(credentials).find((key) => key.orgId === orgId);
  if (!target) return null;
  const stored = credentials.organizations?.[orgId];
  return withOrganization(
    credentials,
    {
      orgId,
      apiKey: stored?.apiKey ?? target.apiKey,
      method: stored?.method ?? credentials.method,
      createdAt: stored?.createdAt ?? credentials.createdAt,
      name: stored?.name,
      slug: stored?.slug
    },
    true
  );
}
function withRejectedKey(credentials, apiKey, at = (/* @__PURE__ */ new Date()).toISOString()) {
  const target = listHeldKeys(credentials).find((key) => key.apiKey === apiKey);
  if (!target) return null;
  const stored = credentials.organizations?.[target.orgId];
  return {
    ...credentials,
    organizations: {
      ...credentials.organizations ?? {},
      [target.orgId]: {
        apiKey,
        method: stored?.method ?? credentials.method,
        createdAt: stored?.createdAt ?? credentials.createdAt,
        ...stored?.name ? { name: stored.name } : {},
        ...stored?.slug ? { slug: stored.slug } : {},
        rejectedAt: at
      }
    }
  };
}

// ../mono-agent-config-oauth/packages/agent-config/files.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path2 = require("node:path");

// ../mono-agent-config-oauth/packages/agent-config/git.ts
var import_node_child_process = require("node:child_process");
var import_node_path = require("node:path");
var GIT_TIMEOUT_MS = 2e3;
var repoCache = /* @__PURE__ */ new Map();
function git(cwd, args) {
  try {
    const out = (0, import_node_child_process.execFileSync)("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}
function normalizeGitRemote(remoteUrl) {
  const raw = remoteUrl.trim();
  if (!raw) return null;
  let normalized;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      normalized = parsed.protocol === "file:" ? `file:${decodeURIComponent(parsed.pathname)}` : `${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}/${parsed.pathname.replace(/^\/+/, "")}`;
    } catch {
      normalized = raw;
    }
  } else {
    const scpStyle = raw.match(/^(?:[^@/]+@)?([^:]+):(.+)$/);
    normalized = scpStyle?.[1] && scpStyle[2] ? `${scpStyle[1].toLowerCase()}/${scpStyle[2]}` : `file:${(0, import_node_path.resolve)(raw)}`;
  }
  return normalized.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/{2,}/g, "/").toLowerCase();
}
function getRepoContext(cwd) {
  const key = (0, import_node_path.resolve)(cwd);
  if (repoCache.has(key)) return repoCache.get(key) ?? null;
  const toplevel = git(key, ["rev-parse", "--show-toplevel"]);
  if (!toplevel) {
    repoCache.set(key, null);
    return null;
  }
  const remoteUrl = git(key, ["remote", "get-url", "origin"]);
  const context = {
    root: toplevel,
    remote: remoteUrl ? normalizeGitRemote(remoteUrl) : null
  };
  repoCache.set(key, context);
  return context;
}
function clearRepoCache() {
  repoCache.clear();
}

// ../mono-agent-config-oauth/packages/agent-config/oauth.ts
var TOKEN_FIELDS = ["accessToken", "refreshToken", "expiresAt"];
function decodeJwtPayload(token) {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = Buffer.from(
      part.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf-8");
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}
function orgIdFromAccessToken(token) {
  const claim = decodeJwtPayload(token)?.organization_id;
  return typeof claim === "string" && claim ? claim : void 0;
}
function upgradeOAuthStore(data) {
  if (!data || typeof data !== "object") return null;
  const raw = data;
  if (raw.type !== "oauth") return null;
  if (raw.version === 2) {
    const organizations = raw.organizations && typeof raw.organizations === "object" ? raw.organizations : {};
    return {
      store: { ...raw, type: "oauth", version: 2, organizations },
      migrated: false,
      droppedTokens: false
    };
  }
  const { accessToken, refreshToken, expiresAt, savedAt, ...registration } = raw;
  const store = {
    ...registration,
    type: "oauth",
    version: 2,
    organizations: {}
  };
  if (typeof refreshToken !== "string" || !refreshToken) {
    return { store, migrated: true, droppedTokens: false };
  }
  const orgId = typeof accessToken === "string" ? orgIdFromAccessToken(accessToken) : void 0;
  if (!orgId) return { store, migrated: true, droppedTokens: true };
  store.organizations[orgId] = {
    accessToken: typeof accessToken === "string" ? accessToken : "",
    refreshToken,
    expiresAt: typeof expiresAt === "number" ? expiresAt : 0,
    ...typeof savedAt === "string" ? { savedAt } : {}
  };
  store.defaultOrganization = orgId;
  return { store, migrated: true, droppedTokens: false };
}
function newOAuthStore(registration) {
  const clean = { ...registration };
  for (const field of TOKEN_FIELDS) delete clean[field];
  return { ...clean, type: "oauth", version: 2, organizations: {} };
}
function listOAuthOrgs(store) {
  if (!store) return [];
  return Object.entries(store.organizations).filter(([, tokens]) => !!tokens?.refreshToken).map(([orgId, tokens]) => ({
    orgId,
    ...tokens.name ? { name: tokens.name } : {},
    ...tokens.slug ? { slug: tokens.slug } : {},
    isDefault: orgId === store.defaultOrganization,
    rejected: !!tokens.rejectedAt
  }));
}
function oauthTokensFor(store, orgId) {
  const tokens = store?.organizations[orgId];
  return tokens?.refreshToken ? tokens : null;
}
function withOAuthTokens(store, orgId, tokens, options = {}) {
  const previous = store.organizations[orgId];
  const { rejectedAt: _cleared, ...kept } = previous ?? {};
  const entry = {
    ...kept,
    ...tokens,
    savedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const hasDefault = !!store.defaultOrganization && !!store.organizations[store.defaultOrganization];
  return {
    ...store,
    organizations: { ...store.organizations, [orgId]: entry },
    defaultOrganization: options.makeDefault || !hasDefault ? orgId : store.defaultOrganization
  };
}
function withRejectedOAuthOrg(store, orgId, at = (/* @__PURE__ */ new Date()).toISOString()) {
  const tokens = store.organizations[orgId];
  if (!tokens) return store;
  return {
    ...store,
    organizations: {
      ...store.organizations,
      [orgId]: { ...tokens, rejectedAt: at }
    }
  };
}
function withoutOAuthOrg(store, orgId) {
  const organizations = { ...store.organizations };
  delete organizations[orgId];
  const next = { ...store, organizations };
  if (store.defaultOrganization === orgId) {
    const [promoted] = Object.keys(organizations);
    if (promoted) next.defaultOrganization = promoted;
    else delete next.defaultOrganization;
  }
  return next;
}
function withDefaultOAuthOrg(store, orgId) {
  if (!oauthTokensFor(store, orgId)) return null;
  return { ...store, defaultOrganization: orgId };
}
function withoutAnyOAuthTokens(store) {
  const next = { ...store, organizations: {} };
  delete next.defaultOrganization;
  return next;
}

// ../mono-agent-config-oauth/packages/agent-config/files.ts
var AGENT_IDS = [
  "claude",
  "cursor",
  "opencode",
  "codex",
  "amp",
  "muse"
];
function getUserDir(home = (0, import_node_os.homedir)()) {
  return (0, import_node_path2.join)(home, ".supermemory");
}
function pluginCredentialsPath(agent, home = (0, import_node_os.homedir)()) {
  switch (agent) {
    case "claude":
      return (0, import_node_path2.join)(home, ".supermemory-claude", "credentials.json");
    case "cursor":
      return (0, import_node_path2.join)(home, ".supermemory-cursor", "credentials.json");
    case "opencode":
      return (0, import_node_path2.join)(home, ".supermemory-opencode", "credentials.json");
    case "codex":
      return (0, import_node_path2.join)(home, ".codex", "supermemory", "credentials.json");
    case "amp":
      return (0, import_node_path2.join)(home, ".amp", "supermemory", "credentials.json");
    case "muse":
      return (0, import_node_path2.join)(home, ".supermemory-muse", "credentials.json");
  }
}
function readPluginApiKey(agent, home) {
  const stored = readJson(
    pluginCredentialsPath(agent, home)
  );
  return typeof stored?.apiKey === "string" && stored.apiKey ? stored.apiKey : null;
}
function readJson(path) {
  try {
    if (!(0, import_node_fs.existsSync)(path)) return null;
    return JSON.parse((0, import_node_fs.readFileSync)(path, "utf-8"));
  } catch {
    return null;
  }
}
function describePluginLogin(agent, home) {
  const path = pluginCredentialsPath(agent, home);
  const stored = readJson(path);
  const login = {
    agent,
    path,
    kind: "none",
    orgs: [],
    unattributed: false,
    routes: false
  };
  if (!stored) return login;
  if (typeof stored.apiKey === "string" && stored.apiKey) {
    const orgId = orgIdFromApiKey(stored.apiKey);
    return {
      ...login,
      kind: "api-key",
      orgs: orgId ? [{ orgId, isDefault: true, rejected: false }] : [],
      unattributed: !orgId
    };
  }
  const upgraded = upgradeOAuthStore(stored);
  if (!upgraded) return login;
  return {
    ...login,
    kind: "oauth",
    orgs: listOAuthOrgs(upgraded.store),
    unattributed: upgraded.droppedTokens,
    routes: !upgraded.migrated
  };
}
function writeJsonAtomic(path, data, mode) {
  (0, import_node_fs.mkdirSync)((0, import_node_path2.dirname)(path), { recursive: true });
  const temporary = `${path}.${(0, import_node_crypto.randomUUID)()}.tmp`;
  try {
    (0, import_node_fs.writeFileSync)(temporary, `${JSON.stringify(data, null, 2)}
`, {
      mode,
      flag: "wx"
    });
    (0, import_node_fs.renameSync)(temporary, path);
  } finally {
    (0, import_node_fs.rmSync)(temporary, { force: true });
  }
}
function appendProjectRule(rule, home) {
  const path = (0, import_node_path2.join)(getUserDir(home), "config.json");
  const current = readJson(path) ?? {};
  const projects = Array.isArray(current.projects) ? current.projects : [];
  const same = (other) => other?.organization === rule.organization && other?.match?.repo === rule.match.repo && other?.match?.path === rule.match.path;
  if (projects.some(same)) return false;
  writeJsonAtomic(path, { ...current, projects: [...projects, rule] }, 420);
  return true;
}
function readCredentialsFile(home) {
  const credentials = readJson(
    (0, import_node_path2.join)(getUserDir(home), "credentials.json")
  );
  return credentials?.apiKey || credentials?.organizations ? credentials : null;
}
function readRoutingConfig(home) {
  return readJson((0, import_node_path2.join)(getUserDir(home), "config.json")) ?? {};
}
function planRepoBinding(cwd, before, orgId) {
  const remote = getRepoContext(cwd)?.remote;
  if (!remote || remote.startsWith("file:")) return null;
  if (!["default", "fallback", "none"].includes(before.source)) return null;
  if (before.orgId === orgId) return null;
  return { match: { repo: remote }, organization: orgId };
}
function readTeamMarker(cwd) {
  let dir = (0, import_node_path2.resolve)(cwd);
  while (true) {
    const path = (0, import_node_path2.join)(dir, ".supermemory", "config.json");
    if ((0, import_node_fs.existsSync)(path)) {
      const marker = readJson(path);
      return marker ? { ...marker, path } : null;
    }
    if ((0, import_node_fs.existsSync)((0, import_node_path2.join)(dir, ".git"))) return null;
    const parent = (0, import_node_path2.dirname)(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ../mono-agent-config-oauth/packages/agent-config/resolve.ts
var import_node_os3 = require("node:os");

// ../mono-agent-config-oauth/packages/agent-config/route.ts
var import_node_fs2 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path3 = require("node:path");
var TIER_REPO_AND_PATH = 0;
var TIER_REPO = 1;
var TIER_PATH = 2;
function expandHome(path, home) {
  if (path === "~") return home;
  if (path.startsWith("~/")) return (0, import_node_path3.join)(home, path.slice(2));
  return path;
}
function realpath(path) {
  try {
    return import_node_fs2.realpathSync.native(path);
  } catch {
    return (0, import_node_path3.resolve)(path);
  }
}
function isWithin(child, parent) {
  if (child === parent) return true;
  const prefix = parent.endsWith(import_node_path3.sep) ? parent : `${parent}${import_node_path3.sep}`;
  return child.startsWith(prefix);
}
function repoPatternMatches(pattern, remote) {
  const want = pattern.trim().toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "").split("/");
  const have = remote.split("/");
  if (want.length !== have.length) return false;
  return want.every((segment, i) => segment === "*" || segment === have[i]);
}
function rankRules(rules, cwd, repo, home) {
  const ranked = [];
  rules.forEach((rule, index) => {
    const match = rule?.match;
    if (!match || typeof rule.organization !== "string") return;
    if (!match.repo && !match.path) return;
    if (match.repo) {
      if (!repo?.remote || !repoPatternMatches(match.repo, repo.remote)) return;
    }
    let pathDepth = 0;
    if (match.path) {
      const expanded = expandHome(match.path, home);
      if (!(0, import_node_path3.isAbsolute)(expanded)) return;
      const rulePath = realpath(expanded);
      if (!isWithin(cwd, rulePath)) return;
      pathDepth = rulePath.split(import_node_path3.sep).filter(Boolean).length;
    }
    const exactSegments = match.repo ? match.repo.split("/").filter((s) => s !== "*").length : 0;
    const tier = match.repo ? match.path ? TIER_REPO_AND_PATH : TIER_REPO : TIER_PATH;
    ranked.push({
      rule,
      index,
      tier,
      weight: match.path ? pathDepth : exactSegments
    });
  });
  return ranked.sort(
    (a, b) => a.tier - b.tier || b.weight - a.weight || b.index - a.index
  );
}
function findHeldKey(reference, held, aliases = {}) {
  const target = aliases[reference] ?? reference;
  return held.find((key) => key.orgId === target) ?? held.find((key) => key.slug === target || key.name === target) ?? null;
}
function describeRule(rule) {
  const parts = [
    rule.match.repo && `repo ${rule.match.repo}`,
    rule.match.path && `path ${rule.match.path}`
  ].filter(Boolean);
  return `${parts.join(" + ")} -> ${rule.organization}`;
}
function describeOrg(org) {
  return org.name ?? org.slug ?? org.orgId;
}
function routeOrganization(options) {
  const env = options.env ?? process.env;
  const home = options.home ?? (0, import_node_os2.homedir)();
  const cwd = realpath(options.cwd);
  const config = options.config ?? readRoutingConfig(home);
  const aliases = config.organizations ?? {};
  const held = options.held;
  const hint = options.loginHint ?? "supermemory org add";
  const trace = [];
  const warnings = [];
  const notices = [];
  let repo;
  const getRepo = () => {
    if (repo === void 0) repo = getRepoContext(cwd);
    return repo;
  };
  const done = (orgId, source, detail, paused = false) => ({
    orgId,
    source,
    detail,
    paused,
    repo: repo ?? null,
    trace,
    warnings,
    notices
  });
  const useOrg = (org, step, source, detail, stepDetail) => {
    if (org.rejected) {
      trace.push({ step, outcome: "rejected", detail: stepDetail });
      warnings.push(
        `The stored login for ${describeOrg(org)} was rejected by the API. Memory is paused here. Run \`${hint}\` to log in again.`
      );
      return done(org.orgId, source, detail, true);
    }
    trace.push({ step, outcome: "used", detail: stepDetail });
    return done(org.orgId, source, detail);
  };
  const orgOverride = env.SUPERMEMORY_ORG;
  if (orgOverride) {
    const org = findHeldKey(orgOverride, held, aliases);
    if (org) {
      return useOrg(
        org,
        "env SUPERMEMORY_ORG",
        "env-org",
        orgOverride,
        orgOverride
      );
    }
    trace.push({
      step: "env SUPERMEMORY_ORG",
      outcome: "no-key",
      detail: orgOverride
    });
    warnings.push(
      `SUPERMEMORY_ORG=${orgOverride} but no stored login for that organization. Run \`${hint}\`.`
    );
    return done(null, "env-org", orgOverride, true);
  }
  const rules = Array.isArray(config.projects) ? config.projects : [];
  const needsRepo = rules.some((rule) => !!rule?.match?.repo);
  const ranked = rules.length ? rankRules(rules, cwd, needsRepo ? getRepo() : null, home) : [];
  const ruleTiers = (tiers) => ranked.filter((entry) => tiers.includes(entry.tier));
  const tryRules = (entries) => {
    const first = entries[0];
    if (!first) return null;
    const { rule } = first;
    const step = `rule ${describeRule(rule)}`;
    const org = findHeldKey(rule.organization, held, aliases);
    if (org) return useOrg(org, step, "rule", describeRule(rule));
    trace.push({ step, outcome: "no-key" });
    warnings.push(
      `Rule ${describeRule(rule)} matched, but no stored login for "${rule.organization}". Memory is paused here. Run \`${hint}\`.`
    );
    return done(
      aliases[rule.organization] ?? null,
      "rule",
      describeRule(rule),
      true
    );
  };
  const fromRepoRules = tryRules(ruleTiers([TIER_REPO_AND_PATH, TIER_REPO]));
  if (fromRepoRules) return fromRepoRules;
  const marker = readTeamMarker(cwd);
  if (marker?.organization) {
    const org = held.find((entry) => entry.orgId === marker.organization);
    const step = `team ${marker.path}`;
    if (org) {
      return useOrg(org, step, "team", marker.path, marker.organization);
    }
    trace.push({ step, outcome: "no-key", detail: marker.organization });
    const byName = findHeldKey(marker.organization, held);
    if (byName) {
      warnings.push(
        `${marker.path} names organization "${marker.organization}" by name. Team files must use the organization id (${byName.orgId}), so it is ignored.`
      );
    } else if (marker.ifMissingKey === "pause") {
      warnings.push(
        `This repository's memories belong to organization ${marker.organization}, and you are not logged in to it. Memory is paused here. Run \`${hint}\`.`
      );
      return done(marker.organization, "team", marker.path, true);
    } else {
      notices.push(
        `This repository belongs to organization ${marker.organization}. You are not logged in to it, so your default organization is used. If you are a member, run \`${hint}\`.`
      );
    }
  }
  const fromPathRules = tryRules(ruleTiers([TIER_PATH]));
  if (fromPathRules) return fromPathRules;
  const fallback = held.find((org) => org.isDefault);
  if (fallback) return useOrg(fallback, "default", "default", "default");
  trace.push({ step: "no login", outcome: "no-match" });
  return done(null, "none", null);
}

// ../mono-agent-config-oauth/packages/agent-config/resolve.ts
function resolveAgentConfig(options) {
  const env = options.env ?? process.env;
  const home = options.home ?? (0, import_node_os3.homedir)();
  const credentials = options.credentials !== void 0 ? options.credentials : readCredentialsFile(home);
  const trace = [];
  const fixed = (apiKey, source, detail) => {
    trace.push({
      step: source === "env" ? `env ${detail}` : detail,
      outcome: "used"
    });
    return {
      apiKey,
      orgId: orgIdFromApiKey(apiKey) ?? null,
      source,
      detail,
      paused: false,
      repo: null,
      trace,
      warnings: [],
      notices: []
    };
  };
  for (const name of options.apiKeyEnvVars ?? []) {
    const value = env[name];
    if (value) return fixed(value, "env", name);
  }
  const held = listHeldKeys(credentials);
  const route = (() => {
    if (env.SUPERMEMORY_ORG) return null;
    for (const override of options.overrides ?? []) {
      if (override.apiKey)
        return fixed(override.apiKey, "override", override.source);
    }
    return null;
  })();
  if (route) return route;
  const routed = routeOrganization({
    cwd: options.cwd,
    held,
    env,
    home,
    ...options.config ? { config: options.config } : {}
  });
  const base = {
    repo: routed.repo,
    trace: [...trace, ...routed.trace],
    warnings: routed.warnings,
    notices: routed.notices
  };
  if (routed.orgId && !routed.paused) {
    const key = held.find((entry) => entry.orgId === routed.orgId);
    if (key) {
      return {
        ...base,
        apiKey: key.apiKey,
        orgId: key.orgId,
        source: routed.source,
        detail: routed.source === "default" ? "credentials.json" : routed.detail,
        paused: false
      };
    }
  }
  if (routed.paused || routed.source !== "none") {
    return {
      ...base,
      apiKey: null,
      orgId: routed.orgId,
      source: routed.source,
      detail: routed.detail,
      paused: routed.paused
    };
  }
  if (credentials?.apiKey) {
    base.trace.push({ step: "default credentials", outcome: "used" });
    return {
      ...base,
      apiKey: credentials.apiKey,
      orgId: null,
      source: "default",
      detail: "credentials.json",
      paused: false
    };
  }
  for (const fallback of options.fallbacks ?? []) {
    if (fallback.apiKey) {
      base.trace.push({ step: fallback.source, outcome: "used" });
      return {
        ...base,
        apiKey: fallback.apiKey,
        orgId: orgIdFromApiKey(fallback.apiKey) ?? null,
        source: "fallback",
        detail: fallback.source,
        paused: false
      };
    }
  }
  return {
    ...base,
    apiKey: null,
    orgId: null,
    source: "none",
    detail: null,
    paused: false
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AGENT_IDS,
  appendProjectRule,
  clearRepoCache,
  describePluginLogin,
  findHeldKey,
  getRepoContext,
  getUserDir,
  listHeldKeys,
  listOAuthOrgs,
  newOAuthStore,
  normalizeGitRemote,
  oauthTokensFor,
  orgIdFromAccessToken,
  orgIdFromApiKey,
  planRepoBinding,
  pluginCredentialsPath,
  readCredentialsFile,
  readPluginApiKey,
  readRoutingConfig,
  readTeamMarker,
  resolveAgentConfig,
  routeOrganization,
  upgradeOAuthStore,
  withDefaultOAuthOrg,
  withDefaultOrganization,
  withOAuthTokens,
  withOrganization,
  withRejectedKey,
  withRejectedOAuthOrg,
  withoutAnyOAuthTokens,
  withoutOAuthOrg,
  withoutOrganization
});
