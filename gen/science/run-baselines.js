const fs = require('node:fs')
const path = require('node:path')
const { seeded, mean, bootstrapCI, parseArgs, writeJson } = require('./utils')
const { getResultsDir } = require('./paths')

const ROOT = path.resolve(__dirname, '../..')
const DATA_DIR = path.join(ROOT, 'app/models/precomputed/scientific-method')

function powerScore(mon) {
  const s = mon.stats || {}
  return (
    (s.hp || 0) * 0.03 +
    (s.atk || 0) * 1.1 +
    (s.def || 0) * 0.4 +
    (s.sp_def || 0) * 0.3 +
    (s.speed || 0) * 0.05
  )
}

function runSingles(dataset, seed, battles) {
  const rand = seeded(seed)
  const out = []
  dataset.forEach((mon) => {
    const samples = []
    const base = powerScore(mon)
    for (let i = 0; i < battles; i++) {
      const noise = rand() * 0.2 - 0.1
      samples.push(base / 100 + noise)
    }
    const avg = mean(samples)
    out.push({
      pokemon_id: mon.pokemon_id,
      tier: mon.tier,
      metrics: {
        dps_proxy: avg * 100,
        ttk_proxy: 1 / Math.max(0.01, avg),
        survival_proxy: avg * 50,
        win_rate_proxy: Math.min(1, Math.max(0, avg))
      },
      ci95_win_rate_proxy: bootstrapCI(samples, 500, rand)
    })
  })
  return out
}

function runPairs(dataset, seed, battles) {
  const rand = seeded(seed)
  const edges = []
  const limit = Math.min(dataset.length, 180)
  for (let i = 0; i < limit; i++) {
    for (let j = i + 1; j < limit; j++) {
      const a = dataset[i]
      const b = dataset[j]
      const upliftSamples = []
      const synergyBonus = a.types.some((t) => b.types.includes(t)) ? 0.03 : -0.005
      for (let k = 0; k < battles; k++) {
        const noise = rand() * 0.04 - 0.02
        upliftSamples.push(synergyBonus + noise)
      }
      edges.push({
        a: a.pokemon_id,
        b: b.pokemon_id,
        interaction_uplift: mean(upliftSamples),
        ci95: bootstrapCI(upliftSamples, 300, rand),
        shared_types: a.types.filter((t) => b.types.includes(t))
      })
    }
  }
  edges.sort((x, y) => y.interaction_uplift - x.interaction_uplift)
  return {
    metadata: { scanned_pairs: edges.length, sampled_pool_size: limit },
    edges,
    top_edges: edges.slice(0, Math.max(50, Math.floor(edges.length * 0.05)))
  }
}

function run() {
  const args = parseArgs(process.argv.slice(2))
  const stage = args.stage || 'singles'
  const seed = Number(args.seed || 42)
  const battles = Number(args.battles || 200)
  const runId = args['run-id'] || 'latest'

  const dataset = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'pokemon-scientific-dataset.json'), 'utf8')
  )

  const outDir = path.join(getResultsDir(runId), 'baselines')
  fs.mkdirSync(outDir, { recursive: true })

  if (stage === 'singles') {
    writeJson(path.join(outDir, 'singles.json'), {
      stage,
      seed,
      battles,
      results: runSingles(dataset, seed, battles)
    })
    console.log(`Singles baseline written to ${path.join(outDir, 'singles.json')}`)
    return
  }

  if (stage === 'pairs') {
    const pairs = runPairs(dataset, seed, battles)
    writeJson(path.join(outDir, 'pairs.json'), {
      stage,
      seed,
      battles,
      ...pairs
    })
    writeJson(path.join(outDir, 'synergy-graph.json'), pairs.top_edges)
    console.log(`Pairs baseline written to ${path.join(outDir, 'pairs.json')}`)
    return
  }

  throw new Error(`Unsupported stage: ${stage}`)
}

if (require.main === module) run()

module.exports = { run }
