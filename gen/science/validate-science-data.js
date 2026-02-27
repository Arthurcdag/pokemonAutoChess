const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const DATA_DIR = path.join(ROOT, 'app/models/precomputed/scientific-method')

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'))
}

function validate() {
  const dataset = readJson('pokemon-scientific-dataset.json')
  const effects = readJson('effect-registry.json')
  const synergies = readJson('synergy-dataset.json')
  const errors = []
  const warnings = []

  const seenPokemonIds = new Set()
  dataset.forEach((p, idx) => {
    if (!p.pokemon_id) errors.push(`pokemon[${idx}] missing pokemon_id`)
    if (seenPokemonIds.has(p.pokemon_id)) errors.push(`duplicate pokemon_id: ${p.pokemon_id}`)
    seenPokemonIds.add(p.pokemon_id)

    if (!Array.isArray(p.types)) errors.push(`${p.pokemon_id} types must be array`)
    if (!Array.isArray(p.type_pairs)) errors.push(`${p.pokemon_id} type_pairs must be array`)
    if (!p.ability_id) errors.push(`${p.pokemon_id} missing ability_id`)

    const hp = p.stats?.hp
    const atk = p.stats?.atk
    if (!Number.isFinite(hp) || hp <= 0) errors.push(`${p.pokemon_id} invalid hp`)
    if (!Number.isFinite(atk) || atk < 0) errors.push(`${p.pokemon_id} invalid atk`)
    if (!Number.isFinite(p.pool_quantity) || p.pool_quantity < 0) {
      errors.push(`${p.pokemon_id} invalid pool_quantity`)
    }
  })

  const seenEffectIds = new Set()
  effects.forEach((e, idx) => {
    if (!e.effect_id) errors.push(`effect[${idx}] missing effect_id`)
    if (seenEffectIds.has(e.effect_id)) warnings.push(`duplicate effect_id registry entry: ${e.effect_id}`)
    seenEffectIds.add(e.effect_id)
    if (e.payload === null) warnings.push(`effect ${e.effect_id} has no structured payload`) // formalization gap
  })

  synergies.forEach((s, idx) => {
    if (!s.synergy_id) errors.push(`synergy[${idx}] missing synergy_id`)
    if (!Array.isArray(s.thresholds)) errors.push(`${s.synergy_id} thresholds must be array`)
    if (!Array.isArray(s.bonuses)) errors.push(`${s.synergy_id} bonuses must be array`)
  })

  if (errors.length > 0) {
    console.error('Science data validation failed:')
    errors.forEach((e) => console.error(`  - ${e}`))
    if (warnings.length > 0) {
      console.error('Warnings:')
      warnings.slice(0, 20).forEach((w) => console.error(`  - ${w}`))
    }
    process.exit(1)
  }

  console.log(`Science data validation passed (${dataset.length} pokemon).`)
  if (warnings.length > 0) {
    console.log(`Warnings (${warnings.length}) found; first 20:`)
    warnings.slice(0, 20).forEach((w) => console.log(`  - ${w}`))
  }
}

if (require.main === module) validate()

module.exports = { validate }
