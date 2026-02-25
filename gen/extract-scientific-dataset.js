const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const CSV_PATH = path.join(ROOT, 'app/models/precomputed/pokemons-data.csv')
const TRANSLATION_PATH = path.join(
  ROOT,
  'app/public/dist/client/locales/en/translation.json'
)
const { getDataDir } = require('./science/paths')

const OUTPUT_DIR = path.join(ROOT, 'app/models/precomputed/scientific-method')
const SYNERGY_CONFIG_PATH = path.join(ROOT, 'app/config/game/synergies.ts')
const EFFECTS_MODEL_PATH = path.join(ROOT, 'app/models/effects.ts')


function resolveDataFile(fileName, fallbackAbsolutePath) {
  const dataPath = path.join(getDataDir(), fileName)
  if (fs.existsSync(dataPath)) return dataPath
  return fallbackAbsolutePath
}

const POOL_SIZE_BY_RARITY_AND_STAR = {
  COMMON: [1, 18, 27],
  UNCOMMON: [1, 13, 22],
  RARE: [1, 9, 18],
  EPIC: [1, 7, 14],
  ULTRA: [1, 5, 10],
  UNIQUE: [1, 1, 1],
  LEGENDARY: [1, 1, 1],
  SPECIAL: [0, 0, 0],
  HATCH: [0, 0, 0]
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const headers = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const cols = line.split(',')
    const row = {}
    headers.forEach((header, i) => {
      row[header] = cols[i] ?? ''
    })
    return row
  })
}

function toBool(value) {
  return String(value).toLowerCase() === 'true'
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function inc(map, key) {
  map[key] = (map[key] || 0) + 1
}

function nCr(n, r) {
  if (r < 0 || r > n) return 0
  if (r === 0 || r === n) return 1
  const k = Math.min(r, n - r)
  let num = 1
  let den = 1
  for (let i = 1; i <= k; i++) {
    num *= n - (k - i)
    den *= i
  }
  return Math.round(num / den)
}

function parseSynergyTriggers(sourceText) {
  const triggers = {}
  const blockMatch = sourceText.match(/export const SynergyTriggers:[\s\S]*?=\s*\{([\s\S]*?)\n\}/)
  if (!blockMatch) return triggers
  const block = blockMatch[1]
  const re = /\[Synergy\.([A-Z_]+)\]:\s*\[([^\]]*)\]/g
  let m
  while ((m = re.exec(block)) !== null) {
    triggers[m[1]] = m[2]
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v))
  }
  return triggers
}

function parseSynergyEffects(sourceText) {
  const result = {}
  const blockMatch = sourceText.match(/export const SynergyEffects:[\s\S]*?=\s*\{([\s\S]*?)\}\s*as const/)
  if (!blockMatch) return result
  const block = blockMatch[1]
  const re = /\[Synergy\.([A-Z_]+)\]:\s*\[([\s\S]*?)\],/g
  let m
  while ((m = re.exec(block)) !== null) {
    const effectIds = [...m[2].matchAll(/EffectEnum\.([A-Z0-9_]+)/g)].map((x) => x[1])
    result[m[1]] = effectIds
  }
  return result
}


function extractNumbers(text) {
  if (!text || typeof text !== 'string') return []
  const matches = text.match(/-?\d+(?:\.\d+)?/g) || []
  return matches.map(Number).filter((n) => Number.isFinite(n))
}

function inferPayloadFromText(text) {
  const nums = extractNumbers(text)
  return {
    raw_numbers: nums,
    inferred_from_text: true
  }
}

function extractScientificDataset() {
  const csvRows = parseCsv(fs.readFileSync(resolveDataFile('pokemons-data.csv', CSV_PATH), 'utf8'))
  const t = JSON.parse(fs.readFileSync(resolveDataFile('translation.en.json', TRANSLATION_PATH), 'utf8'))
  const synergySource = fs.readFileSync(resolveDataFile('synergies.ts', SYNERGY_CONFIG_PATH), 'utf8')
  const effectsSource = fs.readFileSync(resolveDataFile('effects.ts', EFFECTS_MODEL_PATH), 'utf8')
  const synergyTriggers = parseSynergyTriggers(synergySource)
  const synergyEffects = parseSynergyEffects(effectsSource)

  const records = csvRows.map((row) => {
    const pokemonId = row.Name
    const types = [row['Type 1'], row['Type 2'], row['Type 3'], row['Type 4']].filter(Boolean)
    const typePairs = []
    const sortedTypes = [...types].sort()
    for (let i = 0; i < sortedTypes.length; i++) {
      for (let j = i + 1; j < sortedTypes.length; j++) {
        typePairs.push(`${sortedTypes[i]}__${sortedTypes[j]}`)
      }
    }

    const stars = toNumber(row.Tier)
    const pool = POOL_SIZE_BY_RARITY_AND_STAR[row.Category] || [0, 0, 0]
    const poolQuantity = pool[Math.max(0, Math.min(2, stars - 1))] ?? 0

    return {
      pokemon_id: pokemonId,
      name_en: t.pkm?.[pokemonId] || pokemonId,
      index: row.Index,
      rarity: row.Category,
      cost: { COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, ULTRA: 5, HATCH: 9, UNIQUE: 10, LEGENDARY: 20, SPECIAL: 0 }[row.Category] ?? 0,
      tier: stars,
      stage: stars === 1 ? 'basic' : stars === 2 ? 'stage1' : stars === 3 ? 'stage2' : 'stage3',
      family_id: row.Family,
      additional_pick: toBool(row['Additional pick']),
      regional: toBool(row.Regional),
      variant: toBool(row.Variant),
      duo: toBool(row.Duo),
      pool_quantity: poolQuantity,
      stats: {
        hp: toNumber(row.HP),
        atk: toNumber(row.Attack),
        def: toNumber(row.Defense),
        sp_atk: toNumber(row.Attack),
        sp_def: toNumber(row['Special Defense']),
        speed: toNumber(row.Speed),
        range: toNumber(row['Attack Range']),
        mana: toNumber(row['Max PP'])
      },
      types,
      type_pairs: typePairs,
      tags: [],
      ability_id: row.Ability,
      ability_text_en: t.ability_description?.[row.Ability] || 'No description found',
      ability_trigger: 'onCast',
      ability_params: inferPayloadFromText(t.ability_description?.[row.Ability] || ''),
      evolves_to: []
    }
  })

  const byFamily = new Map()
  records.forEach((r) => {
    const arr = byFamily.get(r.family_id) || []
    arr.push(r)
    byFamily.set(r.family_id, arr)
  })
  byFamily.forEach((family) => {
    family.sort((a, b) => a.tier - b.tier)
    family.forEach((mon, idx) => {
      mon.evolves_to = family.slice(idx + 1).map((x) => x.pokemon_id)
    })
  })

  const frequency = {
    rarity: {},
    tier: {},
    stage: {},
    ability: {},
    types: {},
    type_pairs: {}
  }

  for (const row of records) {
    inc(frequency.rarity, row.rarity)
    inc(frequency.tier, String(row.tier))
    inc(frequency.stage, row.stage)
    inc(frequency.ability, row.ability_id)
    row.types.forEach((type) => inc(frequency.types, type))
    row.type_pairs.forEach((pair) => inc(frequency.type_pairs, pair))
  }

  const synergyDataset = Object.keys(t.synergy || {}).map((synergyId) => ({
    synergy_id: `type.${synergyId}`,
    key: synergyId,
    name_en: t.synergy?.[synergyId] || synergyId,
    thresholds: synergyTriggers[synergyId] || [],
    bonuses: (synergyEffects[synergyId] || []).map((effectId) => ({
      effect_id: effectId,
      source_type: 'synergy',
      trigger: 'passive',
      targeting: 'contextual',
      payload: inferPayloadFromText(t.effect_description?.[effectId] || ''),
      cooldown: null,
      mana_cost: null,
      internal_icd: null,
      notes: t.effect_description?.[effectId] || 'No description found'
    })),
    description_en: t.synergy_description?.[synergyId] || 'No description found'
  }))

  const effectRegistry = [
    ...Object.entries(t.ability || {}).map(([abilityId, abilityName]) => ({
      effect_id: abilityId,
      source_type: 'pokemon_ability',
      trigger: 'onCast',
      targeting: 'contextual',
      payload: inferPayloadFromText(t.ability_description?.[abilityId] || ''),
      cooldown: null,
      mana_cost: null,
      internal_icd: null,
      name_en: abilityName,
      notes: t.ability_description?.[abilityId] || 'No description found'
    })),
    ...Object.entries(t.effect || {}).map(([effectId, effectName]) => ({
      effect_id: effectId,
      source_type: 'status_or_synergy_effect',
      trigger: 'passive',
      targeting: 'contextual',
      payload: inferPayloadFromText(t.effect_description?.[effectId] || ''),
      cooldown: null,
      mana_cost: null,
      internal_icd: null,
      name_en: effectName,
      notes: t.effect_description?.[effectId] || 'No description found'
    }))
  ]

  const shopPool = {
    pool_size_by_rarity_and_star: POOL_SIZE_BY_RARITY_AND_STAR,
    shop_odds_by_level: {
      1: [1, 0, 0, 0, 0],
      2: [1, 0, 0, 0, 0],
      3: [0.7, 0.3, 0, 0, 0],
      4: [0.5, 0.4, 0.1, 0, 0],
      5: [0.36, 0.42, 0.2, 0.02, 0],
      6: [0.25, 0.4, 0.3, 0.05, 0],
      7: [0.16, 0.33, 0.35, 0.15, 0.01],
      8: [0.11, 0.27, 0.35, 0.22, 0.05],
      9: [0.05, 0.2, 0.35, 0.3, 0.1]
    }
  }

  const frequencySummary = {
    pokemonCount: records.length,
    rarity: frequency.rarity,
    tier: frequency.tier,
    stage: frequency.stage,
    abilityTop30: Object.entries(frequency.ability).sort((a, b) => b[1] - a[1]).slice(0, 30),
    types: Object.entries(frequency.types).sort((a, b) => b[1] - a[1]),
    typePairsTop40: Object.entries(frequency.type_pairs).sort((a, b) => b[1] - a[1]).slice(0, 40)
  }

  const experimentDesignTemplate = {
    objective: 'Run reproducible scientific experiments on Pokemon team combinations.',
    hypothesisTemplate:
      'If we include [X variable], then [Y metric] will [increase/decrease] because [mechanism].',
    variables: {
      independent: ['pokemon combination', 'type combination', 'ability composition', 'star curve'],
      dependent: ['placement', 'win rate', 'damage dealt', 'damage taken', 'rounds survived'],
      controls: ['patch version', 'economy strategy', 'item policy', 'random seed policy']
    },
    combinationSpace: {
      pokemonPool: records.length,
      uniqueCombinationsAt6: nCr(records.length, 6),
      uniqueCombinationsAt8: nCr(records.length, 8),
      uniqueCombinationsAt10: nCr(records.length, 10)
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUTPUT_DIR, 'pokemon-scientific-dataset.json'), JSON.stringify(records, null, 2))
  fs.writeFileSync(path.join(OUTPUT_DIR, 'frequency-summary.json'), JSON.stringify(frequencySummary, null, 2))
  fs.writeFileSync(path.join(OUTPUT_DIR, 'mechanics-glossary.json'), JSON.stringify({ synergy: synergyDataset, effects: effectRegistry }, null, 2))
  fs.writeFileSync(path.join(OUTPUT_DIR, 'experiment-design-template.json'), JSON.stringify(experimentDesignTemplate, null, 2))
  fs.writeFileSync(path.join(OUTPUT_DIR, 'effect-registry.json'), JSON.stringify(effectRegistry, null, 2))
  fs.writeFileSync(path.join(OUTPUT_DIR, 'synergy-dataset.json'), JSON.stringify(synergyDataset, null, 2))
  fs.writeFileSync(path.join(OUTPUT_DIR, 'shop-pool.json'), JSON.stringify(shopPool, null, 2))

  console.log(`Extracted ${records.length} pokemon records to ${OUTPUT_DIR}`)
}

extractScientificDataset()
