// The token launch radar's model: every number on the board is computed
// from the sealed snapshot's own fields, by the functions in this file.
// No protocol name is ever special-cased.
//
// The value model, in one paragraph: a protocol that records no token is
// priced the way the snapshot's own market already prices its peers. For
// each category, the protocols whose token already trades give a ratio of
// market cap to TVL; the category's median ratio is the multiple a
// pre-token protocol in that category is priced at. That base value is
// then adjusted by three factors the snapshot also carries: the seven-day
// TVL momentum, how long the protocol has run with no token (a longer
// record is a more proven one), and how many chains it already runs on.
// Protocols whose token already trades are never ranked; they are the
// yardstick, and the dashboard shows them apart as the live set.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  multiple: number;
  growth_factor: number;
  maturity_factor: number;
  chain_factor: number;
  watchlist: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  global_multiple: number;
  category_multiples: Record<string, { multiple: number; peers: number }>;
  rows: RadarRow[];
  live: LiveRow[];
}

// ---------- snapshot ----------

export class SnapshotError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (!isRecord(raw)) throw new SnapshotError('snapshot.json is not an object');
  if (typeof raw.as_of !== 'string') throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof raw.floor_usd !== 'number') throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(raw.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(raw.watchlist) || raw.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols: SnapshotProtocol[] = raw.protocols.map((p, i) => {
    if (!isRecord(p)) throw new SnapshotError(`protocols[${i}] is not an object`);
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new SnapshotError(`protocols[${i}] lacks slug, name or tvl_usd`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: raw.as_of, floor_usd: raw.floor_usd, protocols, watchlist: raw.watchlist as string[] };
}

// ---------- the value model ----------

/** A protocol records no token when DefiLlama carries neither id nor symbol nor market cap. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

const SKIP_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const SKIP_NAME_WORDS = /\b(wrapped|staked|staking)\b/i;
const VERSION_TAIL = /\s(v\d+(\.\d+)?|\d+\.\d+)$/i;
const EXCHANGE_HEAD = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/**
 * A protocol is a radar subject when it records no token and is not a
 * wrapped, staked or bridged product of one that already trades — the
 * same hygiene the house's watchlist rule states, applied to every row.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && SKIP_CATEGORIES.has(p.category)) return false;
  if (SKIP_NAME_WORDS.test(p.name)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (EXCHANGE_HEAD.test(p.name)) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const MULTIPLE_MIN = 0.05;
const MULTIPLE_MAX = 20;
const MIN_CATEGORY_PEERS = 3;

/** Market cap per TVL dollar, medians over the protocols whose token already trades. */
export function categoryMultiples(snapshot: Snapshot): {
  global: number;
  byCategory: Map<string, { multiple: number; peers: number }>;
} {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    if (p.category !== null) {
      const list = ratiosByCategory.get(p.category) ?? [];
      list.push(ratio);
      ratiosByCategory.set(p.category, list);
    }
  }
  const clamp = (m: number): number => Math.min(MULTIPLE_MAX, Math.max(MULTIPLE_MIN, m));
  const global = clamp(all.length > 0 ? median(all) : 1);
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [category, ratios] of ratiosByCategory) {
    if (ratios.length >= MIN_CATEGORY_PEERS) {
      byCategory.set(category, { multiple: clamp(median(ratios)), peers: ratios.length });
    }
  }
  return { global, byCategory };
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}

export interface ImpliedParts {
  implied: number;
  multiple: number;
  growth_factor: number;
  maturity_factor: number;
  chain_factor: number;
  age: number | null;
}

export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiples: { global: number; byCategory: Map<string, { multiple: number; peers: number }> },
): ImpliedParts {
  const multiple =
    p.category !== null && multiples.byCategory.has(p.category)
      ? multiples.byCategory.get(p.category)!.multiple
      : multiples.global;
  // Seven-day TVL momentum, damped by half and clamped: a hot week lifts
  // what a launch would be priced at, a cold one discounts it.
  const change = p.change_7d === null ? 0 : Math.min(60, Math.max(-30, p.change_7d));
  const growth_factor = 1 + (change / 100) * 0.5;
  // A longer tokenless record is a more proven protocol.
  const age = ageDays(asOf, p.listed_at);
  const maturity_factor = age === null ? 1 : Math.min(1.35, 1 + 0.12 * Math.log(1 + age / 90));
  // Distribution already built: each extra chain adds a little, capped.
  const chain_factor = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth_factor * maturity_factor * chain_factor));
  return { implied, multiple, growth_factor, maturity_factor, chain_factor, age };
}

// ---------- farm plans ----------

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function capitalTier(tvl: number): string {
  if (tvl >= 5e8) return '$5,000-$25,000';
  if (tvl >= 1e8) return '$1,000-$5,000';
  if (tvl >= 2.5e7) return '$250-$1,000';
  return '$50-$250';
}

function holdDays(age: number | null): number {
  if (age === null) return 90;
  return Math.min(180, Math.max(30, Math.round(age / 6)));
}

interface PlanSlots {
  name: string;
  chain: string;
  capital: string;
  days: number;
  tvl: string;
}

type Playbook = (s: PlanSlots) => string[];

const PLAYBOOKS: Record<string, Playbook> = {
  Dexs: (s) => [
    `Open a wallet on ${s.chain} and fund it with ${s.capital}; ${s.name} holds ${s.tvl} of TVL there, so even a small share of its volume is visible on-chain. Setup takes one evening and under $10 of gas.`,
    `Swap the main pairs on ${s.name} two or three times a week for ${s.days} days; steady, real volume matters more than size, and each swap costs only the pool fee plus gas.`,
    `Add liquidity to one core pool and keep the position open; concentrated ranges earn more but need weekly rebalancing, about 20 minutes a week.`,
    `Hold the LP position through any points or season snapshot the team announces, and keep wallet records of every deposit for later eligibility checks.`,
  ],
  Lending: (s) => [
    `Fund a wallet on ${s.chain} with ${s.capital} in a major stablecoin or ETH; ${s.name} secures ${s.tvl} of supplied assets, and suppliers are the users a launch usually rewards first.`,
    `Supply the full amount on ${s.name} and leave it supplied for at least ${s.days} days; interest accrues daily and the position costs nothing to hold beyond the first gas.`,
    `Borrow at most 30% against the supply and re-supply it once, keeping the health factor above 2.0; check the position weekly, five minutes at a time.`,
    `Repay and re-borrow on a slow monthly cycle rather than churning daily; consistent borrowers with no liquidations read as real users, not farmers.`,
  ],
  Bridge: (s) => [
    `Bridge ${s.capital} from Ethereum to ${s.chain} through ${s.name}'s own interface, never a third-party clone; the transfer itself is the activity that counts and costs the bridge fee plus gas.`,
    `Route one transfer each week in alternating directions for ${s.days} days, varying the corridor so the history reads as genuine use of the network.`,
    `Keep every transaction hash in a note; if a future program asks for proof of activity, the hashes are the record.`,
    `Leave a working balance on the far chain instead of bridging back at once; idle balances on the destination are part of a real user's footprint.`,
  ],
  'Liquid Staking': (s) => [
    `Stake ${s.capital} of the base asset through ${s.name} on ${s.chain}; the stake takes ten minutes and the receipt token starts earning from the first epoch.`,
    `Hold the receipt token for at least ${s.days} days without selling into the first dip; holding time is the cheapest signal a staking protocol can measure.`,
    `Use the receipt token once in a partner money market as collateral, at a conservative ratio, to show the position is working rather than parked.`,
    `Restake or renew before any announced snapshot window closes, and keep the original staking receipt among your records.`,
  ],
  Yield: (s) => [
    `Deposit ${s.capital} into a flagship vault on ${s.name} (${s.chain}); vault shares begin compounding immediately and the deposit is a single transaction.`,
    `Keep the position for ${s.days} days and let the yield compound; withdrawing early resets most programs' holding clocks.`,
    `Split a second, smaller deposit into a different vault on the same protocol after a month, so the history shows breadth as well as size.`,
    `Do one small test withdrawal mid-way to confirm the exit path works, then redeposit; it costs a few dollars of gas and derisks the main position.`,
  ],
  'Risk Curators': (s) => [
    `Allocate ${s.capital} to a curated vault on ${s.name} via ${s.chain}; read the curator's strategy note first, since curator vaults differ widely in what they hold.`,
    `Hold the allocation for ${s.days} days; curated vaults reward duration, and the share price already reflects the curator's work.`,
    `Review the vault's holdings once a month, fifteen minutes, and move only if the strategy changes materially; churn reads as farming.`,
    `Keep the deposit receipts and the dates of any rebalance in a simple log for later eligibility checks.`,
  ],
  RWA: (s) => [
    `Complete ${s.name}'s onboarding or KYC if the product requires it, then commit ${s.capital} on ${s.chain}; onboarding is a one-off cost of about an hour.`,
    `Buy into one tokenized asset and hold it to its first coupon, maturity or reporting date, at least ${s.days} days, so the holding spans a full cycle.`,
    `Claim or reinvest each distribution as it lands rather than letting it sit idle; the claim transactions are visible participation.`,
    `Keep the offering documents and statements with your records; real-world-asset programs audit holders more often than most.`,
  ],
};

const DEFAULT_PLAYBOOK: Playbook = (s) => [
  `Start on ${s.chain} with ${s.capital}: ${s.name} holds ${s.tvl} of TVL and its core product is the activity any future program would measure.`,
  `Use the protocol's main function at least weekly for ${s.days} days; a steady cadence from one wallet reads as a real user, and each interaction costs only gas.`,
  `Hold a working balance or position in the protocol between sessions instead of emptying the wallet after each use.`,
  `Follow the official channels for a points or season announcement and keep records of your first and last activity dates.`,
];

export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const slots: PlanSlots = {
    name: p.name,
    chain: p.chains[0] ?? 'Ethereum',
    capital: capitalTier(p.tvl_usd),
    days: holdDays(age),
    tvl: money(p.tvl_usd),
  };
  const book = (p.category !== null && PLAYBOOKS[p.category]) || DEFAULT_PLAYBOOK;
  return book(slots).map((step) => step.trim());
}

// ---------- the board and the radar data ----------

export function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; parts: Map<string, ImpliedParts> } {
  const multiples = categoryMultiples(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (watchlist.has(p.slug) || isRankable(p)) chosen.set(p.slug, p);
  }
  const parts = new Map<string, ImpliedParts>();
  const scored = [...chosen.values()].map((p) => {
    const part = impliedValue(p, snapshot.as_of, multiples);
    parts.set(p.slug, part);
    return { p, implied: part.implied };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const rows = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p, parts.get(s.p.slug)!.age),
  }));
  return { rows, parts };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 60)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: Math.round((p.mcap_usd! / Math.max(p.tvl_usd, 1)) * 100) / 100,
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { rows, parts } = buildBoard(snapshot);
  const multiples = categoryMultiples(snapshot);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = new Set(snapshot.watchlist);
  const radarRows: RadarRow[] = rows.map((row) => {
    const p = bySlug.get(row.slug)!;
    const part = parts.get(row.slug)!;
    return {
      ...row,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: part.age,
      multiple: Math.round(part.multiple * 1000) / 1000,
      growth_factor: Math.round(part.growth_factor * 1000) / 1000,
      maturity_factor: Math.round(part.maturity_factor * 1000) / 1000,
      chain_factor: Math.round(part.chain_factor * 1000) / 1000,
      watchlist: watchlist.has(row.slug),
    };
  });
  const live = liveRows(snapshot);
  const category_multiples: Record<string, { multiple: number; peers: number }> = {};
  for (const category of [...multiples.byCategory.keys()].sort()) {
    const entry = multiples.byCategory.get(category)!;
    category_multiples[category] = { multiple: Math.round(entry.multiple * 1000) / 1000, peers: entry.peers };
  }
  return {
    board: rows,
    radar: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      watchlist_size: snapshot.watchlist.length,
      board_size: rows.length,
      live_size: live.length,
      global_multiple: Math.round(multiples.global * 1000) / 1000,
      category_multiples,
      rows: radarRows,
      live,
    },
  };
}

/** The gate's board rules, checked locally so a bad board never leaves the program. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'board holds a slug twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const row of board) if (!known.has(row.slug)) return `board names an unknown slug: ${row.slug}`;
  for (const slug of snapshot.watchlist) if (!slugs.has(slug)) return `board misses a watchlist slug: ${slug}`;
  const ranks = new Set(board.map((r) => r.rank));
  if (ranks.size !== board.length) return 'ranks are not 1..N once each';
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return 'implied value rises as rank ascends';
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2) return 'every implied value is the same';
  for (const row of board) {
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 1e14) {
      return `row ${row.slug} has a bad implied value`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} has a farm step of ${len} characters`;
    }
  }
  return null;
}

/** The dashboard's data file: the same board, with the detail the page shows. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
