// Token Radar Live: fetch the live DefiLlama protocol index, score it with the radar-2
// model in lib/model.ts (copied unchanged from the bounty repo), and write the ranked
// board to out/board.json and the dashboard dataset to out/data.js. The snapshot floor
// is $5M of TVL (see FLOOR_USD below): the sealed bounty snapshot's own content went
// that low, and $50M was the house watchlist's floor, not the snapshot's.
//
// The live index is a snapshot of the moment it is fetched: every refresh re-runs the whole
// pipeline, so the board always reflects the latest TVL, growth and listings DefiLlama
// reports. Nothing here talks to make.fun and nothing is submitted anywhere.
//
//   node fetch.mjs [--out <dir>] [--api <url>]
//   node fetch.mjs --help
//
// Serve the result with any static server from out/ (the dashboard at out/dashboard/
// reads ../data.js):  npx serve out  — or:  python3 -m http.server --directory out

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, dataScript } from './lib/model.ts';

const here = dirname(fileURLToPath(import.meta.url));
const API_URL = 'https://api.llama.fi/protocols';
// The snapshot floor: the sealed bounty snapshot's own content went down to $5,007,171
// (439 of its 758 protocols sat below $50M, and the bounty board's smallest row was
// $5,007,171 of TVL). $50M was the house watchlist's floor, not the snapshot's: the
// model ranks whatever the snapshot carries, and the pricing table is priced from the
// same universe. So the live snapshot carries every protocol at or above $5M of TVL,
// which reproduces the sealed snapshot's universe (~758 protocols) and its pricing.
const FLOOR_USD = 5_000_000;

/** --name <value> out of the arguments, or the fallback. */
function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    'token radar live: fetch the live DefiLlama index and score it with radar-2\n' +
      '  node fetch.mjs [--out <dir>] [--api <url>]\n' +
      '  --out  where to write board.json, data.js and the dashboard (default: out/)\n' +
      '  --api  protocol index URL (default: https://api.llama.fi/protocols)\n',
  );
  process.exit(0);
}

const apiUrl = arg('api', API_URL);
const out = arg('out', join(here, 'out'));

/** A finite number, else null. */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A string, else null. */
function str(v) {
  return typeof v === 'string' ? v : null;
}

/** Unix seconds (DefiLlama listedAt) to a YYYY-MM-DD date string, else null. */
function dateOf(listedAt) {
  const t = num(listedAt);
  if (t === null || t <= 0) return null;
  const d = new Date(t * 1000);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const fetchedAt = new Date();
const asOf = fetchedAt.toISOString().slice(0, 10);

const res = await fetch(apiUrl, { headers: { Accept: 'application/json', 'User-Agent': 'token-radar-live/0.1' } });
if (!res.ok) {
  process.stderr.write(`token radar live: ${apiUrl} answered HTTP ${res.status}\n`);
  process.exit(1);
}
const raw = await res.json();
if (!Array.isArray(raw)) {
  process.stderr.write('token radar live: the protocol index is not a JSON array\n');
  process.exit(1);
}

// Normalize every row to the snapshot shape the model scores, and apply the snapshot
// floor here: the model ranks whatever the snapshot carries, so rows below the floor
// (and rows with no TVL at all) never reach it.
const seen = new Set();
const protocols = [];
let droppedNoSlug = 0;
let droppedNoTvl = 0;
let droppedBelowFloor = 0;
for (const p of raw) {
  if (typeof p !== 'object' || p === null) continue;
  const slug = str(p.slug);
  const name = str(p.name);
  if (!slug || !name || seen.has(slug)) {
    droppedNoSlug++;
    continue;
  }
  const tvl = num(p.tvl);
  if (tvl === null) {
    droppedNoTvl++;
    continue;
  }
  if (tvl < FLOOR_USD) {
    droppedBelowFloor++;
    continue;
  }
  seen.add(slug);
  // The live API's symbol is "-" (or "") when a protocol has no ticker, and a real
  // ticker otherwise — including the parent token's ticker on sub-entries whose own
  // market-cap / CoinGecko record is empty (Ethena USDe reports ENA, Morpho Blue
  // MORPHO, SparkLend SPK, exactly as the sealed snapshot did). The model's pre-token
  // rule (no mcap, no CoinGecko id, no symbol) excludes those sub-entries via the
  // symbol, so only the "-" / "" placeholder maps to null: it is the live API's "no
  // ticker" marker, equivalent to the snapshot's null. Nulling every symbol would
  // wrongly rank token-trading sub-products at the top of the board.
  const mcap = num(p.mcap);
  const gecko = str(p.gecko_id);
  const sym = str(p.symbol);
  protocols.push({
    slug,
    name,
    category: str(p.category),
    chains: Array.isArray(p.chains) ? p.chains.filter((c) => typeof c === 'string') : [],
    tvl_usd: tvl,
    change_7d: num(p.change_7d),
    mcap_usd: mcap,
    listed_at: dateOf(p.listedAt),
    gecko_id: gecko,
    symbol: sym === null || sym === '-' || sym === '' ? null : sym,
  });
}

const snapshot = {
  as_of: asOf,
  source: `DefiLlama ${apiUrl}, fetched ${fetchedAt.toISOString()}`,
  floor_usd: FLOOR_USD,
  protocols,
  watchlist: [],
};

const { board, radar } = buildRadar(snapshot);

mkdirSync(out, { recursive: true });
mkdirSync(join(out, 'dashboard'), { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));
writeFileSync(join(out, 'snapshot.json'), `${JSON.stringify(snapshot)}\n`);
writeFileSync(join(out, 'raw-protocols.json'), `${JSON.stringify(raw)}\n`);
for (const name of readdirSync(join(here, 'dashboard'))) {
  if (name.startsWith('.')) continue;
  const path = join(here, 'dashboard', name);
  if (!statSync(path).isFile()) continue;
  copyFileSync(path, join(out, 'dashboard', name));
}

const top = board.slice(0, 5);
process.stdout.write(
  `token radar live: fetched ${raw.length} protocols from DefiLlama (${asOf})\n` +
    `token radar live: dropped ${droppedNoSlug} without a usable slug/name, ${droppedNoTvl} without TVL, ${droppedBelowFloor} below the $5M snapshot floor\n` +
    `token radar live: ${protocols.length} protocols in the snapshot, ${board.length} rows on the board, ${radar.live_size} live-token protocols set aside, global multiple ${radar.global_multiple}\n` +
    top.map((r) => `  #${r.rank} ${r.name} (${r.slug}): TVL $${r.tvl_usd.toLocaleString('en-US')} -> implied $${r.implied_value_usd.toLocaleString('en-US')}`).join('\n') +
    '\n' +
    `token radar live: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'snapshot.json')} and ${join(out, 'dashboard')} (${readdirSync(join(out, 'dashboard')).length} files)\n`,
);
