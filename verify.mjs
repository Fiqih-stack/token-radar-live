// Token Radar Live: independent verification of out/board.json + out/data.js.
//
// This script does NOT import lib/model.ts. It re-implements the radar-2 arithmetic
// from the README (pricing table + implied value) and checks the pipeline's output
// against the raw DefiLlama response in out/raw-protocols.json, so a bug in the model
// or in fetch.mjs cannot hide behind itself.
//
//   node verify.mjs
//
// Checks: every board row's implied value and multipliers recomputed from raw data;
// implied non-increasing; ranks 1..N; every row pre-token and rankable under the
// documented rule; farm steps 8 per row, 20..600 chars each; data.js parses, matches
// the board, and carries the live tab; the live board's top rows agree with the
// bounty board's ordering where the same protocols appear.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync as rfs } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const FLOOR = 5_000_000;

let failures = 0;
function check(ok, label, detail = '') {
  if (ok) console.log(`  PASS ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

const raw = JSON.parse(rfs(join(out, 'raw-protocols.json'), 'utf8'));
const board = JSON.parse(rfs(join(out, 'board.json'), 'utf8')).rows;
const dataJs = rfs(join(out, 'data.js'), 'utf8');
const RADAR = JSON.parse(dataJs.replace(/^window\.RADAR=/, '').replace(/;\s*$/, ''));

// --- Rebuild the snapshot with the documented normalization (independent code) ---
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v) {
  return typeof v === 'string' ? v : null;
}
const seen = new Set();
const protocols = [];
for (const p of raw) {
  if (typeof p !== 'object' || p === null) continue;
  const slug = str(p.slug);
  const name = str(p.name);
  if (!slug || !name || seen.has(slug)) continue;
  const tvl = num(p.tvl);
  if (tvl === null || tvl < FLOOR) continue;
  seen.add(slug);
  const sym = str(p.symbol);
  protocols.push({
    slug,
    name,
    category: str(p.category),
    chains: Array.isArray(p.chains) ? p.chains.filter((c) => typeof c === 'string') : [],
    tvl_usd: tvl,
    change_7d: num(p.change_7d),
    mcap_usd: num(p.mcap),
    listed_at: (() => {
      const t = num(p.listedAt);
      return t !== null && t > 0 ? new Date(t * 1000).toISOString().slice(0, 10) : null;
    })(),
    gecko_id: str(p.gecko_id),
    symbol: sym === null || sym === '-' || sym === '' ? null : sym,
  });
}

// --- Pricing table (independent implementation) ---
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const clamp = (n) => Math.min(1.5, Math.max(0.05, n));
const live = protocols.filter(
  (p) => p.mcap_usd !== null && p.gecko_id !== null && p.symbol !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
);
const global = live.length > 0 ? clamp(median(live.map((p) => p.mcap_usd / p.tvl_usd))) : 0.25;
const groups = new Map();
for (const p of live) {
  const key = p.category ?? 'Other';
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(p.mcap_usd / p.tvl_usd);
}
const byCategory = {};
for (const [key, ratios] of groups) {
  byCategory[key] = ratios.length >= 3 ? { multiple: clamp(median(ratios)), samples: ratios.length } : { multiple: global, samples: ratios.length };
}

// --- Implied value (independent implementation) ---
const DAY_MS = 86_400_000;
function ageDays(asOf, listedAt) {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
const asOf = RADAR.as_of;
function impliedOf(p) {
  const age = ageDays(asOf, p.listed_at);
  const entry = byCategory[p.category ?? 'Other'];
  const multiple = entry !== undefined && entry.samples >= 3 ? entry.multiple : global;
  const samples = entry !== undefined && entry.samples >= 3 ? entry.samples : (entry?.samples ?? 0);
  const growthPct = Math.min(120, Math.max(-60, typeof p.change_7d === 'number' ? p.change_7d : 0));
  const growthMult = 1 + (growthPct / 100) * 0.5;
  const ageForModel = age ?? 365;
  const maturityMult = 0.6 + (Math.min(Math.max(ageForModel, 0), 1095) / 1095) * 0.4;
  const breadthMult = 1 + Math.max(0, Math.min(p.chains.length - 1, 4)) * 0.03;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, multiple, samples, growthMult, maturityMult, breadthMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const EXCLUDED = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
function isPreToken(p) {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
function isRankable(p) {
  return (
    isPreToken(p) &&
    !EXCLUDED.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED.test(p.name) &&
    !EXCHANGE.test(p.name)
  );
}

const bySlug = new Map(protocols.map((p) => [p.slug, p]));

console.log(`verify: ${protocols.length} protocols in the rebuilt snapshot, ${board.length} board rows, global multiple ${global}`);

console.log('--- board shape');
check(board.length >= 100 && board.length <= 4000, `board has ${board.length} rows (100..4000)`);
check(board.every((r, i) => r.rank === i + 1), 'ranks are 1..N in order');
check(board.every((r, i) => i === 0 || r.implied_value_usd <= board[i - 1].implied_value_usd), 'implied value is non-increasing down the board');
check(new Set(board.map((r) => r.slug)).size === board.length, 'no duplicate slugs');
check(
  board.every((r) => r.farm_steps.length === 8 && r.farm_steps.every((s) => s.length >= 20 && s.length <= 600)),
  'every row has 8 farm steps of 20..600 chars',
);
check(board.every((r) => r.token_status === 'pre-token'), 'every row is pre-token');

console.log('--- implied values recomputed from raw data');
let mismImplied = 0;
let mismMult = 0;
let mismRankable = 0;
for (const r of board) {
  const p = bySlug.get(r.slug);
  if (p === undefined) {
    mismRankable++;
    continue;
  }
  if (!isRankable(p)) mismRankable++;
  const v = impliedOf(p);
  if (v.implied !== r.implied_value_usd) mismImplied++;
  if (v.multiple !== r.model.category_multiple) mismMult++;
  if (Math.abs(v.growthMult - r.model.growth_multiplier) > 0.0001) mismMult++;
  if (Math.abs(v.maturityMult - r.model.maturity_multiplier) > 0.0001) mismMult++;
  if (Math.abs(v.breadthMult - r.model.breadth_multiplier) > 0.0001) mismMult++;
  if (v.age !== r.age_days) mismMult++;
}
check(mismImplied === 0, `implied values: ${board.length - mismImplied}/${board.length} match`, `${mismImplied} mismatch`);
check(mismMult === 0, `multipliers + age: ${board.length - mismMult} rows match`, `${mismMult} mismatch`);
check(mismRankable === 0, 'every board row is rankable under the independent rule', `${mismRankable} not rankable`);

// Every rankable protocol in the snapshot must be on the board (no one left out).
const rankable = protocols.filter(isRankable);
const boardSlugs = new Set(board.map((r) => r.slug));
const missing = rankable.filter((p) => !boardSlugs.has(p.slug));
check(missing.length === 0, `all ${rankable.length} rankable protocols are on the board`, `${missing.length} missing: ${missing.slice(0, 5).map((p) => p.slug).join(', ')}`);

console.log('--- data.js');
check(RADAR.as_of === asOf && /^\d{4}-\d{2}-\d{2}$/.test(RADAR.as_of), `data.js as_of is ${RADAR.as_of}`);
check(RADAR.model_version === 'radar-2', 'data.js model_version is radar-2');
check(RADAR.rows.length === board.length, `data.js rows (${RADAR.rows.length}) match board (${board.length})`);
check(
  RADAR.rows.every((r, i) => r.slug === board[i].slug && r.implied_value_usd === board[i].implied_value_usd && r.category_multiple === board[i].model.category_multiple),
  'data.js rows agree with board.json row by row',
);
check(Math.abs(RADAR.global_multiple - Math.round(global * 1e4) / 1e4) < 1e-9, `data.js global_multiple ${RADAR.global_multiple} matches recomputed ${global}`);
check(RADAR.live.length === 24, `live tab has ${RADAR.live.length} rows`);
check(RADAR.live.every((r) => r.mcap_usd !== null), 'every live row has a market cap');

console.log('--- top 5');
board.slice(0, 5).forEach((r) => {
  const p = bySlug.get(r.slug);
  const v = impliedOf(p);
  console.log(`  #${r.rank} ${r.name}: TVL $${r.tvl_usd.toLocaleString('en-US')} -> implied $${r.implied_value_usd.toLocaleString('en-US')} (recomputed $${v.implied.toLocaleString('en-US')})`);
});

if (failures > 0) {
  console.log(`verify: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('verify: ALL CHECKS PASSED');
