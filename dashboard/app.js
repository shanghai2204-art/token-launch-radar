/* Launch Radar — renders window.RADAR (written by main.ts from the sealed
   snapshot) as a sortable, filterable board with a per-protocol detail
   view. No network, no framework: the page is the program's own output. */
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  if (!R || !app) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(v) {
    if (v == null) return '<span class="meta">n/a</span>';
    var cls = v >= 0 ? 'up' : 'down';
    return '<span class="' + cls + '">' + (v >= 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function ageText(days) {
    if (days == null) return 'n/a';
    if (days >= 730) return (days / 365).toFixed(1) + ' yrs';
    if (days >= 60) return Math.round(days / 30.4) + ' mo';
    return days + ' d';
  }

  var categories = {};
  var chains = {};
  R.rows.forEach(function (r) {
    if (r.category) categories[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });

  var multRows = Object.keys(R.category_multiples).sort().map(function (cat) {
    var m = R.category_multiples[cat];
    return '<tr><td>' + esc(cat) + '</td><td>' + m.multiple.toFixed(2) + 'x</td><td>' + m.peers + ' trading peers</td></tr>';
  }).join('');

  app.innerHTML =
    '<header class="top"><h1>LAUNCH <span class="beam">RADAR</span></h1>' +
    '<span class="meta">snapshot <b>' + esc(R.as_of) + '</b> &middot; <b>' + R.board_size + '</b> pre-token protocols ranked &middot; <b>' +
    R.watchlist_size + '</b> on the house watchlist &middot; floor ' + money(R.floor_usd) + '</span></header>' +
    '<p class="tagline">Protocols that record no token yet, priced by what the market already pays for their trading peers — ' +
    'and a concrete plan for farming each one before a launch.</p>' +
    '<section class="model"><h2>How a value is derived</h2>' +
    '<p class="formula">implied value = TVL &times; category multiple &times; growth &times; maturity &times; chains</p>' +
    '<p>The category multiple is the median market-cap-to-TVL ratio of the protocols in that category whose token already trades ' +
    '(global median ' + R.global_multiple.toFixed(2) + 'x where a category has too few trading peers). Growth damps the seven-day TVL change by half. ' +
    'Maturity rewards a longer tokenless record, up to +35%. Chains add 3% per extra chain, up to five. No name is priced by hand: ' +
    'the same function prices every row, and each row\'s detail shows its own factors.</p>' +
    '<details><summary>Category multiples from this snapshot</summary><table class="mult"><tr><th>Category</th><th>Multiple</th><th>Basis</th></tr>' +
    multRows + '</table></details></section>' +
    '<div class="controls">' +
    '<input type="search" id="q" placeholder="Search protocols" aria-label="Search protocols">' +
    '<select id="cat" aria-label="Filter by category"><option value="">All categories</option></select>' +
    '<select id="chain" aria-label="Filter by chain"><option value="">All chains</option></select>' +
    '<label class="chk"><input type="checkbox" id="wl"> Watchlist only</label>' +
    '<span class="count" id="count"></span></div>' +
    '<div id="detail"></div>' +
    '<table class="board"><thead><tr>' +
    '<th data-k="rank" class="num">Rank</th><th data-k="name">Protocol</th><th data-k="chains">Chains</th>' +
    '<th data-k="tvl_usd" class="num">TVL</th><th data-k="change_7d" class="num">7d</th>' +
    '<th data-k="age_days" class="num">Tokenless for</th><th data-k="multiple" class="num">Multiple</th>' +
    '<th data-k="implied_value_usd" class="num">Implied value</th>' +
    '</tr></thead><tbody id="body"></tbody></table>' +
    '<section class="live"><h2>The yardstick — tokens already trading (not ranked)</h2>' +
    '<p class="tagline">These protocols are the peers the multiples come from. They are shown apart, never ranked: the radar exists for the ones still to come.</p>' +
    '<table><thead><tr><th>Protocol</th><th>Symbol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>Cap / TVL</th></tr></thead>' +
    '<tbody id="livebody"></tbody></table></section>' +
    '<footer>Method: every figure comes from the sealed DefiLlama snapshot of ' + esc(R.as_of) + '. A protocol is listed as recording no token ' +
    'when the snapshot carries no token id, symbol or market cap for it; that is the record, not proof none exists. Implied values are this board\'s own model, ' +
    'stated so a reader can disagree with the inputs, not a prediction that a token will be issued or what it will trade at.</footer>';
  app.setAttribute('aria-busy', 'false');

  var catSel = document.getElementById('cat');
  Object.keys(categories).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
  });
  var chainSel = document.getElementById('chain');
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o);
  });

  document.getElementById('livebody').innerHTML = R.live.map(function (p) {
    return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.symbol || '') + '</td><td>' + esc(p.category || '') +
      '</td><td>' + money(p.tvl_usd) + '</td><td>' + money(p.mcap_usd) + '</td><td>' + p.ratio.toFixed(2) + 'x</td></tr>';
  }).join('');

  var sortKey = 'rank';
  var sortDir = 1;
  var openSlug = null;

  function visible() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var cat = catSel.value;
    var chain = chainSel.value;
    var wl = document.getElementById('wl').checked;
    var rows = R.rows.filter(function (r) {
      if (wl && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    rows.sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      if (sortKey === 'name') return sortDir * String(x).localeCompare(String(y));
      if (sortKey === 'chains') { x = a.chains.length; y = b.chains.length; }
      if (x == null) return 1;
      if (y == null) return -1;
      return sortDir * (x - y);
    });
    return rows;
  }

  function showDetail(r) {
    var d = document.getElementById('detail');
    if (!r) { d.innerHTML = ''; return; }
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    d.innerHTML =
      '<div class="detail"><button class="close" id="dclose">Close</button>' +
      '<h3>' + (r.watchlist ? '<span class="wl">&#9670;</span> ' : '') + esc(r.name) + '</h3>' +
      '<div class="sub">Rank #' + r.rank + ' &middot; ' + esc(r.category || 'Uncategorised') + ' &middot; ' + esc(r.chains.join(', ') || 'no chains listed') +
      ' &middot; TVL ' + money(r.tvl_usd) + ' &middot; 7d ' + (r.change_7d == null ? 'n/a' : r.change_7d.toFixed(1) + '%') +
      ' &middot; tokenless for ' + ageText(r.age_days) + (r.watchlist ? ' &middot; on the house watchlist' : '') + '</div>' +
      '<div class="breakdown"><span>TVL <b>' + money(r.tvl_usd) + '</b></span><span>&times; multiple <b>' + r.multiple.toFixed(2) + 'x</b></span>' +
      '<span>&times; growth <b>' + r.growth_factor.toFixed(2) + '</b></span><span>&times; maturity <b>' + r.maturity_factor.toFixed(2) + '</b></span>' +
      '<span>&times; chains <b>' + r.chain_factor.toFixed(2) + '</b></span><span>= implied <b>' + money(r.implied_value_usd) + '</b></span></div>' +
      '<strong>Farm plan</strong><ol class="steps">' + steps + '</ol></div>';
    document.getElementById('dclose').addEventListener('click', function () {
      openSlug = null; showDetail(null); render();
    });
    d.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    var rows = visible();
    document.getElementById('count').textContent = rows.length + ' of ' + R.rows.length + ' shown';
    document.getElementById('body').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (openSlug === r.slug ? ' class="open"' : '') + '>' +
        '<td class="rank num">' + r.rank + '</td>' +
        '<td class="name">' + (r.watchlist ? '<span class="wl">&#9670;</span> ' : '') + esc(r.name) +
        '<span class="cat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(2) + 'x</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
    var trs = document.querySelectorAll('tbody#body tr');
    Array.prototype.forEach.call(trs, function (tr) {
      tr.addEventListener('click', function () {
        var slug = tr.getAttribute('data-slug');
        var row = null;
        R.rows.forEach(function (r) { if (r.slug === slug) row = r; });
        openSlug = openSlug === slug ? null : slug;
        showDetail(openSlug ? row : null);
        render();
      });
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('table.board thead th'), function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (sortKey === k) { sortDir = -sortDir; } else { sortKey = k; sortDir = k === 'rank' || k === 'name' ? 1 : -1; }
      render();
    });
  });
  ['q', 'cat', 'chain', 'wl'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
    document.getElementById(id).addEventListener('change', render);
  });

  // Shareable views: #cat=Dexs, #chain=Ethereum, #wl=1 filter the board,
  // and #open=<slug> opens that protocol's detail, e.g. for screenshots.
  var hash = {};
  location.hash.replace(/^#/, '').split('&').forEach(function (pair) {
    var kv = pair.split('=');
    if (kv.length === 2) hash[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
  });
  if (hash.cat && categories[hash.cat]) catSel.value = hash.cat;
  if (hash.chain && chains[hash.chain]) chainSel.value = hash.chain;
  if (hash.wl === '1') document.getElementById('wl').checked = true;
  if (hash.q) document.getElementById('q').value = hash.q;
  if (hash.open) {
    R.rows.forEach(function (r) { if (r.slug === hash.open) { openSlug = r.slug; showDetail(r); } });
  }

  render();
})();
