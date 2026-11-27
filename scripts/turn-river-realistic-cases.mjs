import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const rangeRevision = 'f9ea705820f13dc1574f29dcb9a0c8773a580f45'
export const preflopPreset = 'GTOw 500nl Simple'
const root = fileURLToPath(new URL('..', import.meta.url))

export function realisticCases(core) {
  const source = execFileSync('git', ['show', rangeRevision + ':public/preflop-ranges.tsv'], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  })
  const rows = source.split(/\r?\n/).map(line => line.split('\t'))
  const columns = rows.shift()
  const spots = new Map(rows.filter(row => row[0] === preflopPreset)
    .map(row => [row.slice(1, 4).join('/'), row]))
  const deck = Array.from({ length: 52 }, (_, i) => core.cardId('23456789TJQKA'[i >> 2] + 'cdhs'[i & 3]))
  const order = deck.flatMap((high, h) => deck.slice(0, h).map(low => core.comboId(low, high)))

  function action(spot, label) {
    const row = spots.get(spot)
    const column = columns.findIndex((name, i) => /^Action\d+$/.test(name) && row?.[i] === label)
    if (column < 0) throw Error('Missing preflop action ' + spot + ' / ' + label)
    const weights = row[column + 1].trim().split(/\s+/).map(Number)
    if (weights.length !== 1326 || weights.some(w => !Number.isFinite(w) || w < 0 || w > 1))
      throw Error('Invalid preflop frequency vector.')
    const mapped = new Float64Array(1326)
    order.forEach((id, i) => { mapped[id] = weights[i] })
    return mapped
  }

  const btn = action('2Bet/BTN/BTN', 'Raise 2.5bb')
  const co = action('2Bet/CO/CO', 'Raise 2.5bb')
  const bbCall = action('3Bet/BTN/BB', 'Call')
  const coBbCall = action('3Bet/CO/BB', 'Call')
  const bbRaise = action('3Bet/BTN/BB', 'Raise 13bb')
  const sbRaise = action('3Bet/BTN/SB', 'Raise 12bb')
  const actionVs = { BB: action('4Bet/BTN/BB', 'Call'), SB: action('4Bet/BTN/SB', 'Call') }
  const btnCall = against => btn.map((weight, i) => weight * actionVs[against][i])
  const btnFourBet = action('4Bet/BTN/BB', 'Raise 27bb')
  const btnFourBetSb = action('4Bet/BTN/SB', 'Raise 26bb')
  // The snapshot ends at the 4-bettor's decision. Approximate BB's conditional call.
  const defendFourBet = { AA: .35, KK: .55, QQ: .8, JJ: .45, TT: .2, AKs: .8, AKo: .42, AQs: .24 }
  const bbFourBetCall = bbRaise.map((w, i) => w * (defendFourBet[core.comboCategory(...core.ALL_COMBOS[i])] ?? 0))
  const sbFourBetCall = sbRaise.map((w, i) => w * (defendFourBet[core.comboCategory(...core.ALL_COMBOS[i])] ?? 0))
  const categoryWeights = weights => {
    const totals = new Map(), counts = new Map()
    for (const [id, cards] of core.ALL_COMBOS.entries()) {
      const category = core.comboCategory(...cards)
      totals.set(category, (totals.get(category) ?? 0) + weights[id])
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
    return Float64Array.from(core.ALL_COMBOS, cards => {
      const category = core.comboCategory(...cards)
      return totals.get(category) / counts.get(category)
    })
  }

  const textures = {
    'ace-high-dry': ['As', '8h', '3d'], 'king-high-dry': ['Ks', '7h', '2d'],
    'low-disconnected': ['8c', '5s', '2c'], 'low-connected': ['7s', '6d', '5d'],
    'high-connected': ['Qs', 'Jh', 'Th'], paired: ['Js', 'Jh', '4h'],
    'double-broadway': ['As', 'Qd', '6d'], rainbow: ['Ts', '7h', '4d'],
    'two-tone': ['Ks', '9d', '4d'], monotone: ['As', '8s', '3s'],
  }
  const positions = {
    'btn-bb-srp': { pot: 550, stack: 9750, weights: [bbCall, btn], ipAggressor: true },
    'co-bb-srp': { pot: 550, stack: 9750, weights: [coBbCall, co], ipAggressor: true },
    'btn-sb-3bet': { pot: 2500, stack: 8800, weights: [sbRaise, btnCall('SB')] },
    'btn-bb-3bet': { pot: 2650, stack: 8700, weights: [bbRaise, btnCall('BB')] },
    'btn-bb-4bet': { pot: 5450, stack: 7300, weights: [bbFourBetCall, btn.map((w, i) => w * btnFourBet[i])], ipAggressor: true },
    'btn-sb-4bet': { pot: 5300, stack: 7400, weights: [sbFourBetCall, btn.map((w, i) => w * btnFourBetSb[i])], ipAggressor: true },
  }
  const one = { flopSizes0: [], flopSizes1: [33], turnSizes0: [], turnSizes1: [75], sizes0: [], sizes1: [75] }
  const multi = { flopSizes0: [], flopSizes1: [33, 75], turnSizes0: [50], turnSizes1: [75], sizes0: [75], sizes1: [75] }
  const raised = { ...multi, flopRaiseSizes0: [75], flopRaiseSizes1: [], turnRaiseSizes0: [], turnRaiseSizes1: [],
    raiseSizes0: [], raiseSizes1: [], maxRaises: 1, allIn: true }
  const sampled = { flopTurnSamples: 6, flopRiverSamples: 5, flopSamplingMethod: 'uniform', flopSamplingSeed: 29 }
  const exact = { flopTurnSamples: 49, flopRiverSamples: 48 }
  function configuration(id, spot, texture, sizes, chance, more = {}) {
    const { pot, stack, weights, ipAggressor } = positions[spot]
    return { id, spot, texture, target: pot * .001 / 2, max: 250, ...more, config: {
      board: textures[texture], pot, stack, weights0: weights[0], weights1: weights[1], maxNodes: 250_000,
      maxRaises: 0, allIn: false, ...sizes, ...chance,
      ...(ipAggressor ? { flopEntryMode: 'ip-aggressor', flopDonkSizes0: [] } : {}),
      ...more.config,
    } }
  }
  const symmetricWeights = positions['btn-bb-srp'].weights.map(categoryWeights)
  return [
    configuration('btn-bb-sampled-one', 'btn-bb-srp', 'ace-high-dry', one, sampled),
    configuration('btn-bb-sampled-one-locked', 'btn-bb-srp', 'ace-high-dry', one, sampled, { lock: 'cbet' }),
    configuration('btn-bb-sampled-multi', 'btn-bb-srp', 'ace-high-dry', multi, sampled),
    configuration('btn-bb-sampled-later-sizes', 'btn-bb-srp', 'ace-high-dry',
      { ...multi, turnSizes0: [33, 75], turnSizes1: [50, 100], sizes0: [50, 100], sizes1: [50, 100] }, sampled, { max: 100 }),
    configuration('btn-bb-sampled-raised', 'btn-bb-srp', 'ace-high-dry', raised, sampled, { lock: 'cbet' }),
    configuration('btn-bb-exact-river-only', 'btn-bb-srp', 'ace-high-dry',
      { ...one, flopSizes1: [], turnSizes1: [] }, exact, { max: 40 }),
    configuration('btn-bb-exact-one', 'btn-bb-srp', 'ace-high-dry', one, exact, { max: 40 }),
    configuration('btn-bb-exact-one-locked', 'btn-bb-srp', 'ace-high-dry', one, exact, { max: 40, lock: 'cbet' }),
    configuration('btn-bb-exact-multi-flop', 'btn-bb-srp', 'ace-high-dry',
      { ...one, flopSizes1: [33, 75] }, exact, { max: 30, lock: 'cbet' }),
    configuration('btn-bb-exact-two-tone-orbits', 'btn-bb-srp', 'two-tone', one, exact,
      { max: 40, config: { weights0: symmetricWeights[0], weights1: symmetricWeights[1] } }),
    configuration('btn-bb-exact-monotone-orbits', 'btn-bb-srp', 'monotone', one, exact,
      { max: 40, config: { weights0: symmetricWeights[0], weights1: symmetricWeights[1] } }),
    configuration('btn-bb-exact-multi', 'btn-bb-srp', 'ace-high-dry', multi, exact, { max: 40 }),
    configuration('btn-bb-exact-stretch', 'btn-bb-srp', 'ace-high-dry', raised, exact, { max: 40, lock: 'cbet' }),
    configuration('co-bb-sampled', 'co-bb-srp', 'king-high-dry', one, sampled),
    configuration('btn-sb-sampled-3bet', 'btn-sb-3bet', 'low-disconnected', multi, sampled),
    configuration('btn-bb-sampled-3bet', 'btn-bb-3bet', 'low-connected', multi, sampled),
    configuration('btn-bb-sampled-4bet', 'btn-bb-4bet', 'high-connected', raised, sampled, { lock: 'cbet' }),
    configuration('btn-sb-sampled-4bet', 'btn-sb-4bet', 'paired', one, sampled, { lock: 'cbet' }),
    ...['paired', 'double-broadway', 'rainbow', 'two-tone', 'monotone'].map(texture =>
      configuration('btn-bb-sampled-' + texture, 'btn-bb-srp', texture, one, sampled)),
  ]
}
