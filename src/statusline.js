const { readState } = require('./lib/statusline-state');

const SYNC_TIMEOUT_MS = 15000;
const SEARCH_DISPLAY_MS = 60000;
const LEARNT_DISPLAY_MS = 120000;

const BLUE = '\x1b[38;2;59;53;243m';
const BRIGHT = '\x1b[38;2;99;91;255m';
const WHITE = '\x1b[97m';
const BOLD = '\x1b[1m';
const R = '\x1b[0m';

// ── Things Added (session start — what supermemory brought to you) ──

const ADDED_TEMPLATES = [
  (n) => `${WHITE}surfaced ${BRIGHT}${n}${WHITE} intents${R}`,
  (n) => `${WHITE}${BRIGHT}${n}${WHITE} intents in the chamber${R}`,
  (n) => `${WHITE}primed with ${BRIGHT}${n}${WHITE} memories${R}`,
  (n) => `${WHITE}${BRIGHT}${n}${WHITE} signals locked in${R}`,
  (n) => `${WHITE}vibing on ${BRIGHT}${n}${WHITE} intents${R}`,
  (n) => `${WHITE}${BRIGHT}${n}${WHITE} context threads pulled${R}`,
  (n) => `${WHITE}wired into ${BRIGHT}${n}${WHITE} memories${R}`,
  (n) => `${WHITE}${BRIGHT}${n}${WHITE} intents dialed in${R}`,
  (n) => `${WHITE}tapped into ${BRIGHT}${n}${WHITE} signals${R}`,
  (n) => `${WHITE}carrying ${BRIGHT}${n}${WHITE} memories${R}`,
  (n) => `${WHITE}${BRIGHT}${n}${WHITE} intents on deck${R}`,
  (n) => `${WHITE}channeling ${BRIGHT}${n}${WHITE} memories${R}`,
  (n) => `${WHITE}running on ${BRIGHT}${n}${WHITE} intents${R}`,
  (n) => `${WHITE}${BRIGHT}${n}${WHITE} signals active${R}`,
  (n) => `${WHITE}powered by ${BRIGHT}${n}${WHITE} memories${R}`,
  (n) => `${WHITE}${BRIGHT}${n}${WHITE} thoughts loaded${R}`,
  (n) => `${WHITE}tuned to ${BRIGHT}${n}${WHITE} frequencies${R}`,
];

// ── Things Learnt (session end — what supermemory took from you) 📘 ──

const LEARNT_TEMPLATES = [
  (n) => `\uD83D\uDCD8 ${BRIGHT}learnt ${WHITE}${n}${BRIGHT} new things${R}`,
  (n) => `\uD83D\uDCD8 ${BRIGHT}picked up ${WHITE}${n}${BRIGHT} insights${R}`,
  (n) => `\uD83D\uDCD8 ${BRIGHT}absorbed ${WHITE}${n}${BRIGHT} patterns${R}`,
  (n) => `\uD83D\uDCD8 ${WHITE}${n}${BRIGHT} new memories formed${R}`,
  (n) => `\uD83D\uDCD8 ${BRIGHT}captured ${WHITE}${n}${BRIGHT} moments${R}`,
  (n) => `\uD83D\uDCD8 ${WHITE}${n}${BRIGHT} lessons in the vault${R}`,
  (n) => `\uD83D\uDCD8 ${BRIGHT}grew by ${WHITE}${n}${BRIGHT} memories${R}`,
  (n) => `\uD83D\uDCD8 ${BRIGHT}banked ${WHITE}${n}${BRIGHT} insights${R}`,
  (n) => `\uD83D\uDCD8 ${WHITE}${n}${BRIGHT} signals internalized${R}`,
  (n) => `\uD83D\uDCD8 ${BRIGHT}leveled up with ${WHITE}${n}${BRIGHT} learnings${R}`,
  (n) => `\uD83D\uDCD8 ${BRIGHT}distilled ${WHITE}${n}${BRIGHT} takeaways${R}`,
  (n) => `\uD83D\uDCD8 ${WHITE}${n}${BRIGHT} new neurons fired${R}`,
  (n) => `\uD83D\uDCD8 ${BRIGHT}encoded ${WHITE}${n}${BRIGHT} experiences${R}`,
  (n) => `\uD83D\uDCD8 ${WHITE}${n}${BRIGHT} memories crystallized${R}`,
];

// ── Things Recalled (mid-session search — pulled back into context) 🔁 ──

const RECALLED_TEMPLATES = [
  (n) => `\uD83D\uDD01 ${WHITE}pulled ${BRIGHT}${n}${WHITE} memories back in${R}`,
  (n) => `\uD83D\uDD01 ${WHITE}resurfaced ${BRIGHT}${n}${WHITE} facts${R}`,
  (n) => `\uD83D\uDD01 ${BRIGHT}${n}${WHITE} memories re-entered the chat${R}`,
  (n) => `\uD83D\uDD01 ${WHITE}brought back ${BRIGHT}${n}${WHITE} signals${R}`,
  (n) => `\uD83D\uDD01 ${BRIGHT}${n}${WHITE} facts summoned${R}`,
  (n) => `\uD83D\uDD01 ${WHITE}dug up ${BRIGHT}${n}${WHITE} memories${R}`,
  (n) => `\uD83D\uDD01 ${BRIGHT}${n}${WHITE} context fragments restored${R}`,
  (n) => `\uD83D\uDD01 ${WHITE}retrieved ${BRIGHT}${n}${WHITE} from the vault${R}`,
  (n) => `\uD83D\uDD01 ${BRIGHT}${n}${WHITE} past signals reconnected${R}`,
  (n) => `\uD83D\uDD01 ${WHITE}recalled ${BRIGHT}${n}${WHITE} memories${R}`,
  (n) => `\uD83D\uDD01 ${BRIGHT}${n}${WHITE} facts reactivated${R}`,
  (n) => `\uD83D\uDD01 ${WHITE}unearthed ${BRIGHT}${n}${WHITE} insights${R}`,
];

// ── Syncing (actively saving) ──

const SYNC_TEMPLATES = [
  () => `${BRIGHT}\u29BB syncing${R}`,
  () => `${BRIGHT}\u29BB learning${R}`,
  () => `${BRIGHT}\u29BB absorbing${R}`,
  () => `${BRIGHT}\u29BB encoding to memory${R}`,
  () => `${BRIGHT}\u29BB capturing session${R}`,
  () => `${BRIGHT}\u29BB writing to the vault${R}`,
  () => `${BRIGHT}\u29BB committing to memory${R}`,
  () => `${BRIGHT}\u29BB saving the vibes${R}`,
  () => `${BRIGHT}\u29BB forming new memories${R}`,
  () => `${BRIGHT}\u29BB distilling insights${R}`,
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function main() {
  const state = readState();
  if (!state.updatedAt) return;

  const now = Date.now();
  const brand = `${BRIGHT}\u26A1${BOLD}${WHITE}supermemory${R}`;

  // Sync always wins
  if (state.ingesting) {
    const elapsed = now - (state.ingestStartedAt || state.updatedAt);
    if (elapsed < SYNC_TIMEOUT_MS) {
      process.stdout.write(`${brand} ${pick(SYNC_TEMPLATES)()}`);
      return;
    }
  }

  // Build pool
  const pool = [];

  // 📘 Things Learnt
  if (state.lastIngestStatus === 'saved' && state.lastIngestAt && now - state.lastIngestAt < LEARNT_DISPLAY_MS) {
    const n = state.learntCount || 1;
    pool.push(pick(LEARNT_TEMPLATES)(n));
  }

  // Things Added
  if (state.memoriesInjected != null && state.memoriesInjected > 0) {
    pool.push(pick(ADDED_TEMPLATES)(state.memoriesInjected));
  }

  // 🔁 Things Recalled
  if (state.lastSearchAt && now - state.lastSearchAt < SEARCH_DISPLAY_MS) {
    pool.push(pick(RECALLED_TEMPLATES)(state.lastSearchResults || 0));
  }

  if (pool.length === 0) return;

  process.stdout.write(`${brand} ${pick(pool)}`);
}

main();
