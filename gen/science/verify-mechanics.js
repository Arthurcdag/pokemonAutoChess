const fs = require('node:fs')
const path = require('node:path')
const { seeded, parseArgs, writeJson } = require('./utils')
const { getResultsDir } = require('./paths')

const ROOT = path.resolve(__dirname, '../..')
const DATA_DIR = path.join(ROOT, 'app/models/precomputed/scientific-method')

function run() {
  const args = parseArgs(process.argv.slice(2))
  const seed = Number(args.seed || 42)
  const runId = args['run-id'] || 'latest'
  const rand = seeded(seed)

  const effectRegistry = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'effect-registry.json'), 'utf8')
  )

  const outDir = path.join(getResultsDir(runId), 'mechanics-verification')
  const tracesPath = path.join(outDir, 'traces.jsonl')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(tracesPath, '')

  const report = {
    seed,
    summary: { total: effectRegistry.length, passed: 0, failed: 0 },
    effects: []
  }

  effectRegistry.forEach((effect, i) => {
    const microScenarioId = `scenario_${String(i + 1).padStart(4, '0')}`
    const payload = effect.payload || {}
    const hasPayloadNumbers = Array.isArray(payload.raw_numbers)

    const trace = {
      micro_scenario_id: microScenarioId,
      event_type: 'effect_executed',
      source_id: effect.effect_id,
      effect_id: effect.effect_id,
      trigger: effect.trigger,
      targets: [`target_${Math.floor(rand() * 3) + 1}`],
      numbers: hasPayloadNumbers ? payload.raw_numbers.slice(0, 5) : [],
      targeting: effect.targeting
    }
    fs.appendFileSync(tracesPath, `${JSON.stringify(trace)}\n`)

    const discrepancies = []
    if (!effect.effect_id) discrepancies.push('missing effect_id')
    if (!effect.trigger) discrepancies.push('missing trigger')
    if (!effect.targeting) discrepancies.push('missing targeting')
    if (!effect.payload || !Array.isArray(effect.payload.raw_numbers)) {
      discrepancies.push('formalization gap: payload.raw_numbers missing')
    }

    const ok = discrepancies.length === 0
    if (ok) report.summary.passed += 1
    else report.summary.failed += 1

    report.effects.push({
      effect_id: effect.effect_id,
      micro_scenario_id: microScenarioId,
      status: ok ? 'pass' : 'fail',
      discrepancies
    })
  })

  writeJson(path.join(outDir, 'report.json'), report)

  if (report.summary.failed > 0) {
    console.error(
      `Mechanics verification failed for ${report.summary.failed}/${report.summary.total} effects. See ${path.join(outDir, 'report.json')}`
    )
    process.exit(1)
  }

  console.log(`Mechanics verification passed (${report.summary.passed}/${report.summary.total})`)
}

if (require.main === module) run()

module.exports = { run }
