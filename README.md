# Token Radar Live

A live token-launch radar: pre-token protocols ranked by implied value, refreshed
from the live DefiLlama protocol index. The model is **radar-2** — the same model as
the bounty dashboard — applied to fresh data instead of a sealed snapshot.

**This is a separate product from the make.fun bounty entry.** The bounty repo
(`token-radar-01`) is frozen and untouched; this repo shares only its model
(`lib/model.ts`, copied unchanged) and its dashboard, adapted for live data. Nothing
here is submitted to any bounty and nothing is pushed anywhere by the pipeline.

## How it works

1. `node fetch.mjs` pulls `https://api.llama.fi/protocols` (free, no key), normalizes
   each protocol to the snapshot shape the model scores (`listedAt` Unix seconds →
   `listed_at` date, `tvl` → `tvl_usd`, `mcap` → `mcap_usd`), drops rows with no TVL
   or below the **$5M snapshot floor**, and scores every rankable pre-token protocol
   with radar-2. ($50M was the bounty watchlist's floor, not the snapshot's: the sealed
   snapshot's own content went down to $5,007,171 of TVL, and the bounty board ranked
   rows that small. The live snapshot mirrors that universe so the pricing matches.)
2. It writes `out/board.json` (the ranked board, with farm plans), `out/data.js`
   (the dashboard dataset), `out/snapshot.json` (the normalized snapshot) and
   `out/raw-protocols.json` (the raw API response, kept for audit), and copies the
   dashboard into `out/dashboard/`.
3. Serve `out/` with any static server and open the dashboard:
   `python3 -m http.server --directory out 8000` → http://localhost:8000/dashboard/

## The model (radar-2, unchanged)

implied = TVL × categoryMultiple × growthMult × maturityMult × breadthMult

- **categoryMultiple** = median mcap/TVL of live-token protocols in the same category
  (at least 3 samples, else the global median), clamped to [0.05, 1.5].
- **growthMult** = 1 + clamp(change_7d, −60, 120)/100 × 0.5.
- **maturityMult** = 0.6 + min(age_days, 1095)/1095 × 0.4 (unknown age = 365 days).
- **breadthMult** = 1 + min(chains − 1, 4) × 0.03.

A protocol is rankable when it is pre-token (no mcap, no CoinGecko id, no symbol) and
not a bridge, liquid-staking/restaking or exchange product, not versioned, and not a
wrapped/staked product or an exchange-named product. One live-API quirk: the API
returns `"-"` instead of null when a protocol has no ticker, so `fetch.mjs` maps
`"-"` (and `""`) to null. A real ticker is kept as-is — sub-entries of token-trading
protocols carry their parent token's ticker (Ethena USDe → ENA, Morpho Blue →
MORPHO, SparkLend → SPK), and the model's symbol rule is what keeps them off the
board, exactly as in the bounty snapshot. Live-token protocols are kept apart in
the Live token tab, priced by the market, never by the model.

## Refresh

Re-run `node fetch.mjs` whenever the board should be current — daily is a good
cadence. Each run is a fresh snapshot: `as_of` is the fetch date, and the board is
rebuilt from scratch, so protocols that launch a token drop off the board and new
listings appear.

## Layout

```
fetch.mjs            the pipeline: fetch -> normalize -> floor -> score -> write
lib/model.ts         radar-2, copied unchanged from the bounty repo
dashboard/           the dashboard (index.html, app.css, app.js), adapted for live data
out/                 generated output (gitignored): board.json, data.js, snapshot.json,
                     raw-protocols.json, dashboard/
```

## License

MIT. See LICENSE.
