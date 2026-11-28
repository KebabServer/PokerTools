import { deck } from './cards.ts'
import { gridHands, startingHandName } from './ranges.ts'

type SpotKind = '2Bet' | '3Bet' | '4Bet'
export type PreflopSpot = { id: string; label: string }
export type PreflopAction = {
  label: string
  color: string
  frequencies: Float64Array
  comboFrequencies: Float64Array
}
export type PreflopSpotContext = { actor: string; investedBb: number[] | null }
export type PreflopPreset = {
  name: string
  ranges: Map<string, PreflopAction[]>
  contexts: Map<string, PreflopSpotContext>
}

export const preflopPositions = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'] as const
export const preflopStudyPath = 'preflop-ranges.tsv'

function spotFor(kind: SpotKind, opener: string, opponent: string): PreflopSpot {
  const label = kind === '2Bet' ? opener + ' RFI'
    : kind === '3Bet' ? opponent + ' vs ' + opener
    : opener + ' vs ' + opponent
  return { id: [kind, opener, opponent].join('/'), label }
}

export const preflopPositionRows = preflopPositions.slice(0, -1).map((opener, row) => ({
  opener,
  opening: spotFor('2Bet', opener, opener),
  responses: preflopPositions.slice(1).map((opponent, column) => column < row ? null : {
    opponent,
    threeBet: spotFor('3Bet', opener, opponent),
    fourBet: spotFor('4Bet', opener, opponent),
  }),
}))

const matchups = preflopPositionRows.flatMap(row => row.responses.filter(response => response !== null))
export const preflopSpotGroups = [
  { label: 'RFI', spots: preflopPositionRows.map(row => row.opening) },
  { label: '3-bet', spots: matchups.map(matchup => matchup.threeBet) },
  { label: '4-bet', spots: matchups.map(matchup => matchup.fourBet) },
]

const spotIds = new Set(preflopSpotGroups.flatMap(group => group.spots.map(spot => spot.id)))

export const preflopColors = {
  raise: '#a63542',
  call: '#226b4c',
  fold: '#2b5285',
  allIn: '#6d284c',
  reraiseCall: '#915323',
  unlisted: '#3a3a3a',
}

function colorForAction(label: string) {
  if (label === 'Fold' || label.endsWith('/F')) return preflopColors.fold
  if (label === 'All In' || label.endsWith('/AI')) return preflopColors.allIn
  if (label === 'Call' || /^R[23](?:\.\d+)?bb\/C$/.test(label)) return preflopColors.call
  if (label.endsWith('/C')) return preflopColors.reraiseCall
  return preflopColors.raise
}

export const preflopHands = gridHands.flat()
const handIndices = new Map(preflopHands.map((hand, index) => [hand, index]))
const combosPerHand = Array<number>(preflopHands.length).fill(0)
export const preflopComboOrder = 'cdhs-low-major-v1'
export const preflopCombos: readonly (readonly [number, number])[] = deck.flatMap(low =>
  deck.slice(low + 1).map(high => [low, high] as const))
const exportIndexByCombo = Uint16Array.from(preflopCombos, ([low, high]) => high * (high - 1) / 2 + low)
const handByExportIndex = new Uint8Array(preflopCombos.length)

// The TSV groups by higher card. PokerTools' internal exact ranges group by lower card.
preflopCombos.forEach(([low, high], index) => {
  const hand = handIndices.get(startingHandName(low, high))!
  handByExportIndex[exportIndexByCombo[index]] = hand
  combosPerHand[hand]++
})

function readFrequencies(vector: string) {
  const values = vector.trim().split(/\s+/)
  if (values.length !== preflopCombos.length) throw new Error('Expected 1,326 combo frequencies.')
  const totals = new Float64Array(preflopHands.length)
  const exportFrequencies = new Float64Array(preflopCombos.length)
  for (const [index, value] of values.entries()) {
    const frequency = Number(value)
    if (!Number.isFinite(frequency) || frequency < 0 || frequency > 1) throw new Error('Invalid combo frequency.')
    exportFrequencies[index] = frequency
    totals[handByExportIndex[index]] += frequency
  }
  return {
    frequencies: totals.map((sum, hand) => sum / combosPerHand[hand]),
    comboFrequencies: Float64Array.from(exportIndexByCombo, index => exportFrequencies[index]),
  }
}

export function parsePreflopPresets(text: string): PreflopPreset[] {
  const [header, ...lines] = text.trimStart().split(/\r?\n/)
  const fields = header.split('\t').map(field => field.trim())
  function column(name: string) {
    const index = fields.indexOf(name)
    if (index === -1) throw new Error('Missing range column ' + name + '.')
    return index
  }
  const presetColumn = column('RangeName')
  const spotColumns = ['Situation', 'Pos1', 'Pos2'].map(column)
  const actorColumn = fields.indexOf('Position')
  const investedColumn = fields.indexOf('Invested')
  const actionColumns = fields.flatMap((field, index) => {
    const match = /^Action(\d+)$/.exec(field)
    return match ? [{ action: index, range: column('Range' + match[1]) }] : []
  })
  if (!actionColumns.length) throw new Error('No action columns.')

  const presets = new Map<string, PreflopPreset>()
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    const row = line.split('\t')
    const name = row[presetColumn]?.trim()
    const spot = spotColumns.map(col => row[col]?.trim()).join('/')
    if (!name || !spotIds.has(spot)) throw new Error('Invalid preflop spot in row ' + (index + 2) + '.')
    const preset = presets.get(name) ?? {
      name, ranges: new Map<string, PreflopAction[]>(), contexts: new Map<string, PreflopSpotContext>(),
    }
    if (preset.ranges.has(spot)) throw new Error('Duplicate preflop spot in row ' + (index + 2) + '.')
    const actions = actionColumns.flatMap(({ action, range }) => {
      const label = row[action]?.trim()
      if (!label || label === 'NoRange') return []
      return [{ label, color: colorForAction(label), ...readFrequencies(row[range] ?? '') }]
    })
    const investedBb = row[investedColumn]?.trim().split(/\s+/).map(Number)
    preset.contexts.set(spot, {
      actor: row[actorColumn]?.trim() ?? '',
      investedBb: investedBb?.length === preflopPositions.length && investedBb.every(value => Number.isFinite(value) && value >= 0)
        ? investedBb : null,
    })
    preset.ranges.set(spot, actions)
    presets.set(name, preset)
  }
  if (!presets.size) throw new Error('No range presets.')
  return [...presets.values()]
}

export function mixForHand(actions: readonly PreflopAction[], index: number) {
  const mix = actions.map(({ label, color, frequencies }) => ({ label, color, frequency: frequencies[index] }))
  const unlisted = 1 - mix.reduce((sum, action) => sum + action.frequency, 0)
  if (mix.length && unlisted > 1e-8) mix.push({ label: 'Unlisted', color: preflopColors.unlisted, frequency: unlisted })
  return mix
}

export function mixBackground(mix: ReturnType<typeof mixForHand>) {
  if (!mix.length) return undefined
  const total = Math.max(1, mix.reduce((sum, action) => sum + action.frequency, 0))
  let fraction = 0
  const stops = mix.filter(action => action.frequency > 1e-8).flatMap(({ color, frequency }) => {
    const start = (fraction * 100).toFixed(4)
    fraction += frequency / total
    const end = Math.min(100, fraction * 100).toFixed(4)
    return [`${color} ${start}%`, `${color} ${end}%`]
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}
