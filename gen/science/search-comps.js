const fs = require('node:fs')
const path = require('node:path')
const { seeded, parseArgs } = require('./utils')
const { validateClaim } = require('./claim-schema')
const { getResultsDir } = require('./paths')

const ROOT = path.resolve(__dirname, '../..')
const DATA_DIR = path.join(ROOT, 'app/models/precomputed/scientific-method')

function cost(mon) {
  return mon.cost || 0
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function compScore(comp, pairMap) {
  let score = comp.reduce((s, m) => s + (m.stats.hp || 0) * 0.02 + (m.stats.atk || 0), 0)
  for (let i = 0; i < comp.length; i++) {
    for (let j = i + 1; j < comp.length; j++) {
      const key = [comp[i].pokemon_id, comp[j].pokemon_id].sort().join('__')
      score += pairMap.get(key) || 0
    }
  }
  return score
}

function buildPairMap(edges) {
  const m = new Map()
  ;(edges || []).forEach((e) => {
    m.set([e.a, e.b].sort().join('__'), e.interaction_uplift || 0)
  })
  return m
}

function generateBeam(dataset, pairMap, budget, levelCap) {
  const sorted = [...dataset].sort((a, b) => (b.stats.atk || 0) - (a.stats.atk || 0))
  const comps = []
  for (let i = 0; i < Math.min(budget, 250); i++) {
    const comp = []
    let c = 0
    for (const mon of sorted) {
      if (comp.length >= levelCap) break
      if (c + cost(mon) <= levelCap * 4) {
        comp.push(mon)
        c += cost(mon)
      }
    }
    comps.push({ units: comp, score: compScore(comp, pairMap) - i * 0.001 })
  }
  return comps
}

function generateEvo(dataset, pairMap, budget, levelCap, seed) {
  const rand = seeded(seed)
  const comps = []
  for (let i = 0; i < budget; i++) {
    const shuffled = [...dataset].sort(() => rand() - 0.5)
    const comp = []
    let c = 0
    for (const mon of shuffled) {
      if (comp.length >= levelCap) break
      if (c + cost(mon) <= levelCap * 4 && mon.pool_quantity > 0) {
        comp.push(mon)
        c += cost(mon)
      }
    }
    comps.push({ units: comp, score: compScore(comp, pairMap) })
  }
  comps.sort((a, b) => b.score - a.score)
  return comps.slice(0, Math.min(300, comps.length))
}

function compToClaim(comp, idx) {
  const ids = comp.units.map((u) => u.pokemon_id)
  const claim = {
    claim_id: `generated.comp.${String(idx + 1).padStart(4, '0')}`,
    statement: `Comp ${ids.join('+')} improves top4 rate over baseline control composition.`,
    null_hypothesis: 'No top4-rate improvement over baseline.',
    dependent_metrics: ['top4_rate', 'win_rate', 'placement'],
    independent_vars: ['composition'],
    controls: ['seed_policy', 'shop_odds_policy', 'opponent_set_fixed'],
    test_design: {
      experiment_type: 'A/B',
      sample_size: 800,
      acceptance_criteria: 'Top4-rate delta > 0.03 with CI excluding 0',
      conditions: [
        { id: 'candidate', composition: ids },
        { id: 'baseline', composition: [] }
      ]
    },
    metadata: {
      heuristic_score: comp.score,
      total_cost: comp.units.reduce((s, m) => s + (m.cost || 0), 0)
    }
  }
  const v = validateClaim(claim)
  if (!v.valid) throw new Error(`Invalid generated claim ${claim.claim_id}: ${v.errors.join('; ')}`)
  return claim
}

function run() {
  const args = parseArgs(process.argv.slice(2))
  const mode = args.mode || 'beam'
  const budget = Number(args.budget || 5000)
  const seed = Number(args.seed || 42)
  const levelCap = Number(args.level || 8)
  const runId = args['run-id'] || 'latest'

  const dataset = readJson(path.join(DATA_DIR, 'pokemon-scientific-dataset.json'))
  const outDir = getResultsDir(runId)
  const pairsPath = path.join(outDir, 'baselines/pairs.json')
  const pairs = fs.existsSync(pairsPath) ? readJson(pairsPath) : { edges: [] }
  const pairMap = buildPairMap(pairs.edges)

  const comps = mode === 'evo'
    ? generateEvo(dataset, pairMap, budget, levelCap, seed)
    : generateBeam(dataset, pairMap, budget, levelCap)

  const top = comps.slice(0, Math.min(120, comps.length))
  const claims = top.map(compToClaim)

  const out = path.join(outDir, 'generated-claims.jsonl')
  fs.writeFileSync(out, claims.map((c) => JSON.stringify(c)).join('\n') + '\n')

  console.log(`Generated ${claims.length} candidate comp claims -> ${out}`)
}

if (require.main === module) run()

module.exports = { run }
