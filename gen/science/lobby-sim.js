const fs = require('node:fs')
const path = require('node:path')
const { seeded } = require('./utils')

const ROOT = path.resolve(__dirname, '../..')
const DATA_DIR = path.join(ROOT, 'app/models/precomputed/scientific-method')
const POLICIES_PATH = path.join(ROOT, 'policies/registry.json')

const LEVEL_XP = [0, 2, 6, 10, 20, 36, 56, 80, 100]

function loadData() {
  const dataset = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'pokemon-scientific-dataset.json'), 'utf8')
  )
  const shop = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'shop-pool.json'), 'utf8'))
  const policies = JSON.parse(fs.readFileSync(POLICIES_PATH, 'utf8'))
  return { dataset, shop, policies }
}

function mkUnit(mon) {
  return {
    pokemon_id: mon.pokemon_id,
    cost: mon.cost,
    tier: mon.tier,
    types: mon.types,
    stats: mon.stats
  }
}

function unitStrength(u) {
  const s = u.stats || {}
  return (s.hp || 0) * 0.03 + (s.atk || 0) * 1.3 + (s.def || 0) * 0.4 + (s.sp_def || 0) * 0.2 + (s.speed || 0) * 0.05
}

function teamStrength(player) {
  const units = player.board
  const base = units.reduce((acc, u) => acc + unitStrength(u), 0)
  const typeCounts = {}
  units.forEach((u) => u.types.forEach((t) => (typeCounts[t] = (typeCounts[t] || 0) + 1)))
  const synergyBonus = Object.values(typeCounts).reduce((acc, c) => acc + (c >= 2 ? 0.04 : 0), 0)
  const itemBonus = player.items * 0.05
  const frontline = units.filter((u) => (u.stats.range || 1) <= 2).length
  const positioningBonus = units.length ? Math.min(0.05, frontline / units.length / 10) : 0
  return base * (1 + synergyBonus + itemBonus + positioningBonus)
}

function pickByOdds(rand, arr, vals) {
  const r = rand()
  let c = 0
  for (let i = 0; i < arr.length; i++) {
    c += arr[i]
    if (r <= c) return vals[i]
  }
  return vals[vals.length - 1]
}

function makeGlobalPool(dataset) {
  const pool = new Map()
  dataset.forEach((m) => {
    pool.set(m.pokemon_id, m.pool_quantity)
  })
  return pool
}

function rollShop(player, dataset, shopOdds, pool, rand) {
  const offers = []
  const rarityOrder = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'ULTRA']
  const weights = shopOdds[String(Math.min(9, player.level))] || shopOdds['9']
  for (let i = 0; i < 5; i++) {
    const rarity = pickByOdds(rand, weights, rarityOrder)
    const candidates = dataset.filter((m) => m.rarity === rarity && (pool.get(m.pokemon_id) || 0) > 0)
    if (!candidates.length) continue
    offers.push(candidates[Math.floor(rand() * candidates.length)])
  }
  return offers
}

function chooseBuy(player, offers, policy) {
  if (!offers.length) return null
  if (policy.id === 'policy.value-curve') {
    return [...offers].sort((a, b) => unitStrength(mkUnit(b)) / Math.max(1, b.cost) - unitStrength(mkUnit(a)) / Math.max(1, a.cost))[0]
  }
  if (policy.id === 'policy.forced-comp') {
    const targetSet = new Set(policy.target_units || [])
    const target = offers.find((o) => targetSet.has(o.pokemon_id))
    if (target) return target
  }
  const boardTypeCount = {}
  player.board.forEach((u) => u.types.forEach((t) => (boardTypeCount[t] = (boardTypeCount[t] || 0) + 1)))
  return [...offers].sort((a, b) => {
    const sa = a.types.reduce((s, t) => s + (boardTypeCount[t] || 0), 0)
    const sb = b.types.reduce((s, t) => s + (boardTypeCount[t] || 0), 0)
    return sb - sa
  })[0]
}

function maybeLevel(player, policy) {
  const target = policy.leveling === 'aggressive' ? Math.min(9, player.round / 3 + 3) : Math.min(9, player.round / 4 + 2)
  while (player.level < target && player.gold >= 4) {
    player.gold -= 4
    player.xp += 4
    while (player.level < 9 && player.xp >= LEVEL_XP[player.level]) player.level += 1
  }
}

function applyEconomy(player) {
  const base = 5
  const interest = Math.min(5, Math.floor(player.gold / 10))
  const streakBonus = Math.abs(player.streak) >= 2 ? Math.min(3, Math.floor(Math.abs(player.streak) / 2)) : 0
  const income = base + interest + streakBonus
  player.gold += income
  return { base, interest, streakBonus, income }
}

function pruneBoard(player) {
  const cap = Math.max(1, player.level)
  player.board.sort((a, b) => unitStrength(b) - unitStrength(a))
  if (player.board.length > cap) {
    const sold = player.board.splice(cap)
    const refund = sold.reduce((s, u) => s + Math.max(1, u.cost - 1), 0)
    player.gold += refund
  }
}

function battle(a, b, rand) {
  const sa = teamStrength(a)
  const sb = teamStrength(b)
  const pA = sa / Math.max(1e-9, sa + sb)
  const aWin = rand() < pA
  return aWin ? [a, b] : [b, a]
}

function simulateLobby({ players = 8, seed = 42, rounds = 30, policyName = 'policy.greedy-synergy', opponentPolicies = [] }) {
  const { dataset, shop, policies } = loadData()
  const rand = seeded(seed)
  const policyMap = new Map(policies.map((p) => [p.id, p]))

  const pool = makeGlobalPool(dataset)
  const roster = []
  for (let i = 0; i < players; i++) {
    const pName = i === 0 ? policyName : (opponentPolicies[i - 1] || policyName)
    roster.push({
      id: `P${i + 1}`,
      policy: policyMap.get(pName) || policyMap.get('policy.greedy-synergy'),
      hp: 100,
      gold: 10,
      xp: 0,
      level: 2,
      board: [],
      bench: [],
      streak: 0,
      items: 0,
      placement: null,
      round: 0,
      timeline: []
    })
  }

  const aliveOrder = []

  for (let round = 1; round <= rounds; round++) {
    const alive = roster.filter((p) => p.hp > 0)
    alive.forEach((p) => {
      p.round = round
      const econ = applyEconomy(p)
      maybeLevel(p, p.policy)
      const offers = rollShop(p, dataset, shop.shop_odds_by_level, pool, rand)
      const bought = []
      for (let attempt = 0; attempt < 3; attempt++) {
        const pick = chooseBuy(p, offers, p.policy)
        if (!pick || p.gold < pick.cost) break
        if ((pool.get(pick.pokemon_id) || 0) <= 0) break
        p.gold -= pick.cost
        pool.set(pick.pokemon_id, (pool.get(pick.pokemon_id) || 0) - 1)
        const unit = mkUnit(pick)
        p.board.push(unit)
        bought.push(unit.pokemon_id)
        if (p.policy.id !== 'policy.forced-comp') break
      }
      if (round % 5 === 0) p.items += 1
      pruneBoard(p)
      p.timeline.push({ round, phase: 'economy_shop', econ, bought, gold_after: p.gold, level: p.level, hp: p.hp })
    })

    const fighters = roster.filter((p) => p.hp > 0).sort(() => rand() - 0.5)
    for (let i = 0; i < fighters.length - 1; i += 2) {
      const a = fighters[i]
      const b = fighters[i + 1]
      const [winner, loser] = battle(a, b, rand)
      const damage = Math.max(3, Math.floor((teamStrength(winner) - teamStrength(loser)) / 50) + 4)
      loser.hp -= damage
      winner.streak = Math.max(1, winner.streak + 1)
      loser.streak = Math.min(-1, loser.streak - 1)
      winner.timeline.push({ round, phase: 'combat', vs: loser.id, result: 'win', dealt: damage, hp: winner.hp })
      loser.timeline.push({ round, phase: 'combat', vs: winner.id, result: 'loss', taken: damage, hp: loser.hp })
      if (loser.hp <= 0 && loser.placement == null) {
        aliveOrder.unshift(loser.id)
        loser.placement = players - aliveOrder.length + 1
      }
    }
  }

  const survivors = roster.filter((p) => p.hp > 0).sort((a, b) => b.hp - a.hp)
  survivors.forEach((p, idx) => {
    if (p.placement == null) p.placement = idx + 1
  })

  const final = roster
    .map((p) => ({
      player_id: p.id,
      policy_id: p.policy.id,
      placement: p.placement,
      hp: p.hp,
      gold: p.gold,
      level: p.level,
      top4: p.placement <= 4,
      timeline: p.timeline
    }))
    .sort((a, b) => a.placement - b.placement)

  return {
    seed,
    rounds,
    players,
    policies: roster.map((p) => ({ player_id: p.id, policy_id: p.policy.id })),
    final_standings: final,
    pool_remaining_summary: {
      total_units_remaining: [...pool.values()].reduce((a, b) => a + b, 0)
    }
  }
}

module.exports = { simulateLobby }
