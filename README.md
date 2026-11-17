# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/shanghai2204-art/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/shanghai2204-art/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot and ranks 198 protocols that record no token yet by an implied value, each with a concrete farm plan, in a static dashboard with sortable columns, category and chain filters, a watchlist view, and a detail view per protocol.

The value model prices a pre-token protocol the way the snapshot's own market prices its peers: implied value = TVL × category multiple × growth × maturity × chains. The category multiple is the median market-cap-to-TVL ratio of the protocols in that category whose token already trades (the global median where a category has too few trading peers). Growth damps the seven-day TVL change by half, maturity rewards a longer tokenless record up to +35%, and each extra chain adds 3% up to five. Protocols whose token already trades are never ranked; the dashboard shows them apart as the yardstick the multiples come from. No protocol name is priced by hand — one function in `lib/model.ts` prices every row, and each detail view shows that row's own factors.

Farm plans are written per category (vaults, lending, DEX liquidity, staking, bridges, RWA) and instantiated with the protocol's main chain, a capital tier from its TVL, and a holding period from its age, so every step states what to do, what it costs, and how long it takes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. The program writes `board.json`, the dashboard's `data.js`, copies `dashboard/` and `screenshots/` into the output directory, and writes `dossier.json` last, byte for byte as the scorer rebuilds it.

---

<sub>Entered on [make.fun](https://make.fun/?ref=a2pa2qga&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
