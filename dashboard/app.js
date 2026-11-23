// Token Radar Live's plain dashboard. It reads window.RADAR (written beside dashboard/ by fetch.mjs) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, and a model sandbox that re-runs the model live. No network:
// every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var BASE = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, podiumOpen: true, sandbox: { growth_weight: BASE.growth_weight, maturity_floor: BASE.maturity_floor, breadth_per_chain: BASE.breadth_per_chain } };
  var detailTab = 'value';

  // Whether any filter is active: the podium heading, the row count and the chips share it.
  function filtered() {
    return state.category !== 'all' || state.chain !== 'all' || state.minTvl > 0 || state.q.trim() !== '';
  }

  // Whether a filter that also applies to the live list is active.
  function liveFiltered() {
    return state.category !== 'all' || state.chain !== 'all' || state.minTvl > 0 || state.q.trim() !== '';
  }

  // The sort's natural direction: rank 1 and A-to-Z first, everything else biggest first.
  function defaultDir(key) { return key === 'name' || key === 'rank' ? 1 : -1; }

  // A hash number that is in range and on the slider's step, else null.
  function stepValue(raw, min, max, step) {
    if (raw === null || raw === undefined) return null;
    var v = Number(raw);
    if (!isFinite(v) || v < min || v > max) return null;
    if (Math.abs(v / step - Math.round(v / step)) > 1e-9) return null;
    return v;
  }

  // The table's caption states the order it actually shows, so a sorted view never
  // claims to be "strongest implied value first" when it is not.
  function sortNote(live) {
    var key = state.sort;
    var labels = { implied: 'implied value', rank: 'rank', tvl: 'TVL', growth: '7-day growth', age: 'age', multiple: 'category multiple', name: 'name', mcap: 'market cap' };
    var label = live ? (key === 'tvl' || key === 'growth' || key === 'name' || key === 'mcap' ? labels[key] : 'market cap') : labels[key];
    var dirText;
    if (label === 'name') dirText = state.dir < 0 ? 'Z to A' : 'A to Z';
    else if (label === 'rank') dirText = state.dir < 0 ? 'rank ' + DATA.board_size + ' first' : 'rank 1 first';
    else dirText = state.dir < 0 ? 'highest first' : 'lowest first';
    return 'sorted by ' + label + ', ' + dirText + '.';
  }

  var CATEGORIES = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
  var CHAINS = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(2); }

  // The model in one function: the page recomputes a row from the live figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // The sandbox overrides only the three weights; the category multiple stays the market's own.
  function impliedOf(row, model) {
    var growth = Math.min(BASE.growth_cap, Math.max(BASE.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? BASE.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), BASE.maturity_days) / BASE.maturity_days) * BASE.maturity_range;
    var breadth = 1 + Math.max(0, Math.min((row.chains || []).length - 1, BASE.breadth_max_chains)) * model.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * breadth));
  }
  function liveImplied(row) { return impliedOf(row, state.sandbox); }
  function shownValue(r) { return sandboxOn() ? liveImplied(r) : r.implied_value_usd; }
  function sandboxOn() {
    return state.sandbox.growth_weight !== BASE.growth_weight || state.sandbox.maturity_floor !== BASE.maturity_floor || state.sandbox.breadth_per_chain !== BASE.breadth_per_chain;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function has(s) { for (var i = 1; i < arguments.length; i++) if ((s || '').indexOf(arguments[i]) >= 0) return true; return false; }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (has(c, 'ethereum')) return 8;
    if (has(c, 'solana', 'hyperliquid')) return 0.01;
    if (has(c, 'arbitrum', 'optimism', 'base', 'zksync', 'blast', 'scroll')) return 0.5;
    if (has(c, 'binance', 'bnb', 'bsc')) return 0.3;
    if (has(c, 'polygon')) return 0.1;
    if (has(c, 'avalanche')) return 0.5;
    return 2;
  }
  function weeklyActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (has(c, 'lend', 'cdp', 'collateral')) return 'Repay a little of the loan or add $' + small + ' of collateral on ' + name + '.';
    if (has(c, 'dex', 'yield', 'leveraged farm')) return 'Swap $' + small + " through " + name + "'s main pool on " + chain + '.';
    if (has(c, 'bridge')) return 'Bridge $' + small + ' through ' + name + ' again and use the funds in its app.';
    if (has(c, 'staking', 'restak')) return 'Check the staking rewards on ' + name + ' and restake what it paid.';
    if (has(c, 'perpetual', 'derivative')) return 'Open and close one small hedge on ' + name + ' with $' + small + ' of margin.';
    if (has(c, 'prediction')) return 'Place one more small market position on ' + name + '.';
    if (has(c, 'curator', 'allocator')) return 'Add $' + small + ' to the ' + name + ' vault or rebalance it.';
    return 'Make one qualifying action on ' + name + ', such as a deposit, a borrow, a swap or a vote.';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (has(c, 'lend', 'cdp', 'collateral')) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (has(c, 'dex', 'yield', 'leveraged farm')) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (has(c, 'bridge')) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (has(c, 'staking', 'restak')) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (has(c, 'perpetual', 'derivative')) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (has(c, 'prediction')) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (has(c, 'curator', 'allocator')) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (has(c, 'stable')) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (has(c, 'rwa')) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (has(c, 'insurance')) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (has(c, 'basis')) return 'Deposit $' + capital + ' of USDC into ' + name + "'s basis vault on " + chain + ' and hold the position.';
    if (has(c, 'chain')) return 'Bridge $' + capital + ' of USDC to the ' + name + ' chain and use its main app once a week.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    var weeks = Math.max(1, Math.round(hold / 7));
    var txs = 2 + weeks + 1;
    var totalGas = Math.round(gas * txs * 100) / 100;
    var gasText = totalGas >= 1 ? '$' + totalGas : '$' + totalGas.toFixed(2);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'about $' + gas + ' of gas for the first transaction', time: '5 minutes' },
      { text: "Open " + p.name + "'s own points or rewards page first, and only farm it if it publishes one.", cost: 'nothing to check', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: weeklyActionFor(p, capital, chain), cost: 'about $' + gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'Plan total: $' + capital + ' of capital, ' + txs + ' transactions, over ' + hold + ' days.', cost: 'about ' + gasText + ' of gas in total', time: hold + ' days all in' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    function g(k) { return params.get(k); }
    if (g('q')) state.q = g('q');
    // Only a board slug names a detail: a live-token slug (or anything else) is
    // not a selection, so it is dropped instead of lingering in the URL.
    if (g('p')) {
      var pslug = g('p');
      if (DATA.rows.some(function (r) { return r.slug === pslug; })) state.selected = pslug;
    }
    if (g('category') && CATEGORIES.indexOf(g('category')) >= 0) state.category = g('category');
    if (g('chain') && CHAINS.indexOf(g('chain')) >= 0) state.chain = g('chain');
    if (g('tab') === 'live' || g('tab') === 'pre-token') state.tab = g('tab');
    if (g('mintvl')) {
      var mv = Number(g('mintvl'));
      if ([50000000, 100000000, 500000000, 1000000000].indexOf(mv) >= 0) state.minTvl = mv;
    }
    if (g('sort')) {
      var sk = g('sort');
      if (['implied', 'rank', 'tvl', 'growth', 'age', 'multiple', 'name', 'mcap'].indexOf(sk) >= 0) {
        // 'mcap' only means anything in the live tab; anywhere else it is not a sort.
        if (sk !== 'mcap' || state.tab === 'live') state.sort = sk;
      }
    }
    state.dir = defaultDir(state.sort);
    if (g('dir') === '1' || g('dir') === '-1') state.dir = Number(g('dir'));
    if (state.tab !== 'live' && state.sort === 'mcap') { state.sort = 'implied'; state.dir = defaultDir('implied'); }
    // The sandbox weights are part of the view: a copied link must reproduce
    // them. Each weight is validated against its slider's range and step.
    var sg = stepValue(g('sg'), 0, 1, 0.05);
    var sm = stepValue(g('sm'), 0.4, 0.8, 0.05);
    var sb = stepValue(g('sb'), 0, 0.06, 0.01);
    if (sg !== null) state.sandbox.growth_weight = sg;
    if (sm !== null) state.sandbox.maturity_floor = sm;
    if (sb !== null) state.sandbox.breadth_per_chain = sb;
    if (g('dtab') === 'farm') detailTab = 'farm';
    if (g('podium') === '0') state.podiumOpen = false;
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.minTvl > 0) p.set('mintvl', String(state.minTvl));
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir !== defaultDir(state.sort)) p.set('dir', String(state.dir));
    if (state.tab !== 'pre-token') p.set('tab', state.tab);
    if (state.selected) p.set('p', state.selected);
    if (sandboxOn()) {
      p.set('sg', String(state.sandbox.growth_weight));
      p.set('sm', String(state.sandbox.maturity_floor));
      p.set('sb', String(state.sandbox.breadth_per_chain));
    }
    if (state.selected && detailTab === 'farm') p.set('dtab', 'farm');
    if (!state.podiumOpen) p.set('podium', '0');
    var next = p.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortValue(r, key) {
    if (key === 'rank') return r.rank;
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
    if (key === 'multiple') return r.category_multiple;
    return shownValue(r);
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      // Unknowns always sort last, whichever direction the reader chose: an
      // unknown growth or age is not the smallest value, it is no value.
      var aNull = (key === 'growth' && a.change_7d === null) || (key === 'age' && a.age_days === null);
      var bNull = (key === 'growth' && b.change_7d === null) || (key === 'age' && b.age_days === null);
      if (aNull && !bNull) return 1;
      if (bNull && !aNull) return -1;
      var av = sortValue(a, key), bv = sortValue(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // The live list answers the same filters as the board (search, category, chain,
  // minimum TVL) and the same sort, except the keys it has no column for fall
  // back to market cap, which is the order data.js already carries.
  function liveRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.live.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function liveSortValue(r, key) {
    if (key === 'mcap') return r.mcap_usd === null ? 0 : r.mcap_usd;
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? null : r.change_7d;
    if (key === 'name') return r.name.toLowerCase();
    return r.mcap_usd === null ? 0 : r.mcap_usd;
  }
  function liveSorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var aNull = key === 'growth' && a.change_7d === null;
      var bNull = key === 'growth' && b.change_7d === null;
      if (aNull && !bNull) return 1;
      if (bNull && !aNull) return -1;
      var av = liveSortValue(a, key), bv = liveSortValue(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar Live' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Live data · ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' }),
        el('span', { text: 'No network: all data on this page' })
      )
    );
  }

  function lede() {
    // The headline fact follows the view in force: the filter and the sandbox.
    // The top 10 are the current view's top 10, not the board file's — so the
    // lede and the podium below it never disagree about what is "top".
    var on = sandboxOn();
    var topRows = rows().slice().sort(function (a, b) {
      return shownValue(b) - shownValue(a);
    }).slice(0, 10);
    var top10 = topRows.reduce(function (sum, r) { return sum + shownValue(r); }, 0);
    var topLabel = 'Top ' + topRows.length + ' implied value' + (filtered() ? ' in this view' : '') + (on ? ' (sandbox weights)' : '');
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', { text: 'Every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record, ranked by implied value from the live DefiLlama index. Each protocol is priced like the live-token protocols in its own category trade. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'TVL floor' }), el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: topLabel }), el('b', { text: topRows.length ? fmtUsd(top10) : '—' })),
        el('div', { class: 'fact' }, el('span', { text: 'Top 24 live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function podium() {
    // The strip follows the same filter as the table below it, so the two never
    // disagree about what is "top": no filter means the global top 10.
    var list = rows().slice().sort(function (a, b) {
      return shownValue(b) - shownValue(a);
    }).slice(0, 10);
    if (list.length === 0) return null;
    var top = shownValue(list[0]);
    var items = list.map(function (r) {
      var v = shownValue(r);
      return el('li', { tabindex: '0', role: 'button', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('span', { class: 'rank', text: '#' + r.rank }),
        el('b', { text: r.name, title: r.name }),
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round((v / top) * 100)) + '%' })),
        el('span', { class: 'num', text: fmtUsd(v) })
      );
    });
    var head = el('div', { class: 'podium-head' },
      el('h2', { text: filtered() ? 'Top ' + list.length + ' in this view' : 'Top 10 by implied value' }),
      el('button', { type: 'button', class: 'button small', id: 'podium-toggle', 'aria-expanded': state.podiumOpen ? 'true' : 'false', 'aria-label': (state.podiumOpen ? 'Hide' : 'Show') + ' podium', text: state.podiumOpen ? 'Hide' : 'Show', onclick: function () { state.podiumOpen = !state.podiumOpen; writeHash(); render(); } })
    );
    return el('section', { class: 'podium' }, head, state.podiumOpen ? el('ol', null, items) : null);
  }

  function controls() {
    var categories = CATEGORIES;
    var chains = CHAINS;
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var tvl = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      [['0', 'Any TVL'], ['50000000', 'TVL $50M+'], ['100000000', 'TVL $100M+'], ['500000000', 'TVL $500M+'], ['1000000000', 'TVL $1B+']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: String(state.minTvl) === o[0] ? 'selected' : null });
      })
    );
    tvl.addEventListener('change', function () { state.minTvl = Number(tvl.value); writeHash(); render(); });
    // The live tab has no rank, implied value, age or category multiple to sort by:
    // it offers the sorts that apply there, market cap first.
    var sortOptions = state.tab === 'live'
      ? [['mcap', 'Sort: market cap'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day growth'], ['name', 'Sort: name']]
      : [['implied', 'Sort: implied value'], ['rank', 'Sort: rank'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day growth'], ['age', 'Sort: age'], ['multiple', 'Sort: category multiple'], ['name', 'Sort: name']];
    var sort = el('select', { id: 'sort', 'aria-label': 'Sort by' },
      sortOptions.map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: state.sort === o[0] ? 'selected' : null });
      })
    );
    sort.addEventListener('change', function () { state.sort = sort.value; state.dir = defaultDir(state.sort); writeHash(); render(); });
    var pre = el('button', { type: 'button', id: 'tab-pre', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; if (state.sort === 'mcap') { state.sort = 'implied'; state.dir = defaultDir('implied'); } writeHash(); render(); } });
    var live = el('button', { type: 'button', id: 'tab-live', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; if (['rank', 'implied', 'multiple', 'age'].indexOf(state.sort) >= 0) { state.sort = 'mcap'; state.dir = defaultDir('mcap'); } writeHash(); render(); } });
    return el('div', { class: 'controls', id: 'controls', tabindex: '-1' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('label', { for: 'mintvl', text: 'Minimum TVL' }), tvl),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort' }), sort),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? (filtered() ? rows().length + ' of ' + DATA.board_size + ' rows' : rows().length + ' rows shown') : (liveFiltered() ? liveRows().length + ' of ' + DATA.live.length + ' live-token protocols' : DATA.live.length + ' live-token protocols') })
    );
  }

  // The active filters as chips: each one clears just that filter, so the reader
  // never has to rebuild the whole filter set to drop one condition.
  function chips() {
    var list = [];
    if (state.q.trim() !== '') list.push({ label: 'Search: "' + state.q.trim() + '"', clear: function () { state.q = ''; }, focus: 'q' });
    if (state.category !== 'all') list.push({ label: 'Category: ' + state.category, clear: function () { state.category = 'all'; }, focus: 'category' });
    if (state.chain !== 'all') list.push({ label: 'Chain: ' + state.chain, clear: function () { state.chain = 'all'; }, focus: 'chain' });
    if (state.minTvl > 0) list.push({ label: 'Min TVL ' + (state.minTvl >= 1e9 ? '$1B' : '$' + (state.minTvl / 1e6) + 'M') + '+', clear: function () { state.minTvl = 0; }, focus: 'mintvl' });
    if (list.length === 0) return null;
    var items = list.map(function (f) {
      return el('button', { type: 'button', class: 'chip', 'aria-label': 'Clear filter ' + f.label, onclick: function () { f.clear(); writeHash(); render(); var c = document.getElementById(f.focus); if (c) c.focus(); } },
        el('span', { class: 'chip-q', text: f.label }), el('span', { text: '  ×' })
      );
    });
    items.push(el('button', { type: 'button', class: 'chip clear-all', text: 'Clear all ×', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); var q = document.getElementById('q'); if (q) q.focus(); } }));
    return el('div', { class: 'chips' }, el('span', { class: 'sub', text: 'Active filters:' }), items);
  }

  function sortHeader(key, label) {
    var th = el('th', { scope: 'col' },
      el('button', { type: 'button', id: 'sort-' + key, onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = defaultDir(key); } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
    if (state.sort === key) th.setAttribute('aria-sort', state.dir < 0 ? 'descending' : 'ascending');
    return th;
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', id: 'clear-filters', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, r) { var v = shownValue(r); return v > m ? v : m; }, 1);
    var tbody = el('tbody');
    list.forEach(function (r, i) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var implied = shownValue(r);
      var tr = el('tr', {
        'data-slug': r.slug,
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: i === 0 ? '0' : '-1',
        role: 'button',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            var rows = tr.parentNode.children, n = rows[[...rows].indexOf(tr) + (e.key === 'ArrowDown' ? 1 : -1)];
            if (n) { tr.tabIndex = -1; n.tabIndex = 0; n.focus(); }
          }
        }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.category_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(implied) })
        )),
        el('td', null, el('span', { class: 'status pre', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel board-table' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, ' + sortNote(false) + ' Select a row for its model and farm plan.' + (sandboxOn() ? ' Sandbox weights are on: values use your weights.' : '') }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Cat. multiple'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var list = liveSorted(liveRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No live-token protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the live list again.' }),
        el('button', { class: 'button primary', type: 'button', id: 'clear-filters', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : fmtMult(r.mcap_tvl_ratio) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. Their median market-cap / TVL by category is what prices the pre-token board. They are set aside from the pre-token ranking. ' + sortNote(true) }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'), sortHeader('growth', '7d'), sortHeader('mcap', 'Market cap'), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = BASE;
    // The formula shows the weights in force: the sandbox's when it is on, the
    // board defaults otherwise. The paragraph below names the defaults the board
    // file uses, so the formula and the paragraph never disagree.
    var w = sandboxOn() ? state.sandbox : BASE;
    function slider(id, label, key, min, max, step) {
      var out = el('output', { for: id, text: String(state.sandbox[key]) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(state.sandbox[key]), 'aria-label': label });
      // Live on input would rebuild the whole page and destroy this slider mid-drag,
      // so the value follows the thumb at once and the board recomputes on release.
      input.addEventListener('input', function () { state.sandbox[key] = Number(input.value); out.textContent = input.value; });
      input.addEventListener('change', function () { writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), input, out);
    }
    var pricingRows = Object.keys(DATA.category_multiples).sort().map(function (c) {
      var e = DATA.category_multiples[c];
      return el('tr', null,
        el('td', { text: c }),
        el('td', { class: 'num', text: fmtMult(e.multiple) }),
        el('td', { class: 'num', text: String(e.samples) + (e.samples < m.multiple_min_samples ? ' (uses global)' : '') })
      );
    });
    return el('section', { class: 'panel model', id: 'model', tabindex: '-1' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the live figures. No protocol name is special-cased, and no row is hand-picked. The category multiple is the median market-cap / TVL of the live-token protocols in the same category (at least ' + m.multiple_min_samples + ' of them, else the global median ' + fmtMult(DATA.global_multiple) + '), clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + '].' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + w.growth_weight + ') x (' + w.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + min(chains - 1, ' + m.breadth_max_chains + ') x ' + w.breadth_per_chain + ') )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the live DefiLlama index. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Move a slider and release it to recompute the board; ' + (sandboxOn() ? 'the formula above shows your sandbox weights, and the board file itself uses the defaults (growth weight ' + BASE.growth_weight + ', maturity floor ' + BASE.maturity_floor + ', breadth ' + BASE.breadth_per_chain + ').' : 'the board file itself uses the defaults above.') }),
      el('div', { class: 'sandbox' },
        slider('sb-growth', 'Growth weight', 'growth_weight', 0, 1, 0.05),
        slider('sb-maturity', 'Maturity floor', 'maturity_floor', 0.4, 0.8, 0.05),
        slider('sb-breadth', 'Breadth per extra chain', 'breadth_per_chain', 0, 0.06, 0.01)
      ),
      el('button', { class: 'button', type: 'button', id: 'reset-sandbox', text: 'Reset sandbox to the board defaults', onclick: function () { state.sandbox = { growth_weight: BASE.growth_weight, maturity_floor: BASE.maturity_floor, breadth_per_chain: BASE.breadth_per_chain }; writeHash(); render(); } }),
      el('div', { class: 'pricing' },
        el('h2', { text: 'Category pricing, from the live-token protocols' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Live protocols' }))),
            el('tbody', null, pricingRows)
          )
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  // A floating way back to the filters: it only appears once the controls have
  // scrolled out of view, so it never covers the board at the top of the page.
  var filterBtn = el('button', { class: 'filter-fab', type: 'button', text: '↑ Filters', onclick: function () { var c = document.getElementById('controls'); if (c) { c.scrollIntoView({ block: 'start' }); c.focus({ preventScroll: true }); } } });
  filterBtn.hidden = true;
  document.body.appendChild(filterBtn);
  window.addEventListener('scroll', function () {
    var c = document.getElementById('controls');
    filterBtn.hidden = !c || c.getBoundingClientRect().bottom > 0;
  }, { passive: true });

  document.querySelectorAll('a.skip').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var t = document.getElementById(a.hash.slice(1));
      if (t) { t.scrollIntoView(); t.focus({ preventScroll: true }); }
    });
  });

  function setDetailTab(t) {
    detailTab = t;
    writeHash();
    var v = document.getElementById('detail-value');
    var f = document.getElementById('detail-farm');
    if (v) v.hidden = (t !== 'value');
    if (f) f.hidden = (t !== 'farm');
    var tv = document.getElementById('detail-tab-value');
    var tf = document.getElementById('detail-tab-farm');
    if (tv) tv.setAttribute('aria-selected', t === 'value' ? 'true' : 'false');
    if (tf) tf.setAttribute('aria-selected', t === 'farm' ? 'true' : 'false');
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    // Mark the row in the table now, so it stays visibly selected after the
    // detail closes, whichever way it was opened (click, keyboard, podium, hash).
    var prev = app.querySelectorAll('tr[data-selected="true"]');
    for (var i = 0; i < prev.length; i++) prev[i].setAttribute('data-selected', 'false');
    var rowEl = app.querySelector('tr[data-slug="' + CSS.escape(slug) + '"]');
    if (rowEl) rowEl.setAttribute('data-selected', 'true');
    dialog.textContent = '';
    var steps = farmSteps(row);
    // The detail shows the model that is actually in force: the board's defaults,
    // or the reader's sandbox weights when they are on. Mixing the two would show
    // one implied value in the equation and another in the build-up below it.
    var sandbox = sandboxOn();
    var round4 = function (n) { return Math.round(n * 1e4) / 1e4; };
    var growthClamped = Math.min(BASE.growth_cap, Math.max(BASE.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    // Full precision, in both branches: the stored multipliers are rounded to 4
    // decimals, and multiplying the rounded ones can move the build-up's final
    // line across a display boundary (Veda #4: $343.0M vs $343.1M). The labels
    // below still show round4, so what the reader sees does not change.
    var w = sandbox ? state.sandbox : BASE;
    var growthMult = 1 + (growthClamped / 100) * w.growth_weight;
    var ageForModel = row.age_days === null || row.age_days === undefined ? BASE.unknown_age_days : row.age_days;
    var maturityMult = w.maturity_floor + (Math.min(Math.max(ageForModel, 0), BASE.maturity_days) / BASE.maturity_days) * BASE.maturity_range;
    var breadthMult = 1 + Math.max(0, Math.min((row.chains || []).length - 1, BASE.breadth_max_chains)) * w.breadth_per_chain;
    var recomputed = impliedOf(row, sandbox ? state.sandbox : BASE);
    var shown = sandbox ? recomputed : row.implied_value_usd;
    var base = row.tvl_usd * row.category_multiple;
    var afterGrowth = base * growthMult;
    var afterMaturity = afterGrowth * maturityMult;
    var afterBreadth = afterMaturity * breadthMult;
    // A row whose age or growth the live index does not record still scores: the
    // model uses a fallback, and the dialog says so instead of leaving the
    // multiplier looking asserted.
    var fallbacks = [];
    if (row.age_days === null || row.age_days === undefined) fallbacks.push('age unlisted, so the model uses ' + BASE.unknown_age_days + ' days');
    if (row.change_7d === null || row.change_7d === undefined) fallbacks.push('seven-day growth unreported, so the model uses 0%');
    var fallbackNote = fallbacks.length > 0 ? el('p', { class: 'sub', text: 'Fallbacks in this row: ' + fallbacks.join('; ') + '.' }) : null;
    var buildup = el('div', { class: 'buildup' },
      el('div', null, el('span', { text: 'Base: TVL x category multiple' }), el('b', { class: 'num', text: fmtUsd(base) })),
      el('div', null, el('span', { text: 'After growth (x' + round4(growthMult) + ')' }), el('b', { class: 'num', text: fmtUsd(afterGrowth) })),
      el('div', null, el('span', { text: 'After maturity (x' + round4(maturityMult) + ')' }), el('b', { class: 'num', text: fmtUsd(afterMaturity) })),
      el('div', null, el('span', { text: 'After breadth (x' + round4(breadthMult) + ') = implied value' }), el('b', { class: 'num', text: fmtUsd(afterBreadth) }))
    );
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' - records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('div', { class: 'detail-tabs', role: 'tablist', 'aria-label': 'Detail sections', onkeydown: function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      var next = detailTab === 'value' ? 'farm' : 'value';
      setDetailTab(next);
      var btn = document.getElementById(next === 'value' ? 'detail-tab-value' : 'detail-tab-farm');
      if (btn) btn.focus();
    } },
      el('button', { type: 'button', class: 'detail-tab', id: 'detail-tab-value', role: 'tab', 'aria-controls': 'detail-value', 'aria-selected': detailTab === 'value' ? 'true' : 'false', text: 'Implied value', onclick: function () { setDetailTab('value'); } }),
      el('button', { type: 'button', class: 'detail-tab', id: 'detail-tab-farm', role: 'tab', 'aria-controls': 'detail-farm', 'aria-selected': detailTab === 'farm' ? 'true' : 'false', text: 'Farm plan', onclick: function () { setDetailTab('farm'); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section', id: 'detail-value', role: 'tabpanel', 'aria-labelledby': 'detail-tab-value', hidden: detailTab === 'farm' ? 'hidden' : null },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) + ' (' + row.comparable_protocols + (row.comparable_protocols === 1 ? ' live comparable' : ' live comparables') + (row.comparable_protocols < 3 ? ', uses global median' : '') + ')' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(round4(growthMult)) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(round4(maturityMult)) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(round4(breadthMult)) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(shown) }))
      ),
      buildup,
      fallbackNote,
      el('p', { class: 'sub', text: sandbox
        ? 'Model ' + DATA.model_version + ' with your sandbox weights: the page recomputes this row as ' + fmtUsd(recomputed) + '. The board file uses the defaults, ' + fmtUsd(row.implied_value_usd) + '. This is an estimate, not a price.'
        : 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section', id: 'detail-farm', role: 'tabpanel', 'aria-labelledby': 'detail-tab-farm', hidden: detailTab === 'value' ? 'hidden' : null },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'note', text: 'A protocol on this board records no token in the live index; that is the record, not proof it has none. Never pay to claim an airdrop.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    // The modal blocks the page, so a rebuild while the detail is open would pull
    // the open dialog out of the document and out of the top layer, where
    // showModal is skipped because the dialog still reports itself open.
    if (dialog.open) return;
    // Keep the user's focus across the rebuild: every control re-renders the whole
    // page, so without this the search box loses focus (and the caret) on each keystroke.
    var focusId = document.activeElement && document.activeElement.id;
    var selStart = null, selEnd = null;
    if (focusId === 'q') { selStart = document.activeElement.selectionStart; selEnd = document.activeElement.selectionEnd; }
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    // The podium is the pre-token board's top 10: it has no meaning above the
    // live-token table, so the live tab shows the table on its own.
    if (state.tab === 'pre-token') {
      var pod = podium();
      if (pod) shell.appendChild(pod);
    }
    shell.appendChild(controls());
    var ch = chips();
    if (ch) shell.appendChild(ch);
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('footer', { class: 'foot', text: 'Token Radar Live, model ' + DATA.model_version + '. Live data ' + DATA.as_of + ', DefiLlama protocol index. Implied values are this radar\u2019s own estimate, never a price or a promise.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    else if (focusId) {
      var focusEl = document.getElementById(focusId);
      if (focusEl) {
        focusEl.focus();
        if (focusId === 'q' && selStart !== null) {
          try { focusEl.setSelectionRange(selStart, selEnd); } catch (e) { /* older engines */ }
        }
      } else {
        // The control the user was on is gone (e.g. Clear filters removed the empty
        // state): fall back to the search box instead of dropping focus to the page.
        var q = document.getElementById('q');
        if (q) q.focus();
      }
    }
  }

  readHash();
  // Normalise the URL once at load: invalid or unknown params (a bad p, a bad
  // sort, a stray dir) are dropped instead of lingering in the address bar.
  writeHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
    else if (e.key === 'Tab' && dialog.open) {
      var tab = document.getElementById('detail-tab-' + detailTab);
      var closeBtn = dialog.querySelector('.close');
      if (!e.shiftKey && document.activeElement === tab) { e.preventDefault(); closeBtn.focus(); }
      else if (e.shiftKey && document.activeElement === closeBtn) { e.preventDefault(); tab.focus(); }
    }
  });
})();
