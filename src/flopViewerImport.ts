import { assertDistinct, cardText, readCards } from './cards.ts'
import type { FlopAction, FlopCombo, FlopNode, FlopSpot } from './flopStrategy.ts'

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected ' + label + '.')
  return value as Record<string, unknown>
}

function name(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing ' + label + '.')
  return value.trim()
}

function cardsFor(value: unknown, label: string, count: number) {
  const cards = readCards(name(value, label))
  if (cards.length !== count) throw new Error('Expected ' + count + ' cards for ' + label + '.')
  assertDistinct(cards)
  return cards.sort((a, b) => b - a)
}

function readAction(value: unknown): FlopAction {
  const action = record(value, 'an action object')
  const label = name(action.label, 'action label')
  if (action.color === undefined) return { label }
  const color = name(action.color, 'action color')
  if (!/^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]{1,25})$/i.test(color)) {
    throw new Error('Use a hex color or a named color for ' + label + '.')
  }
  return { label, color }
}

function readNode(value: unknown, board: number[]): FlopNode {
  const node = record(value, 'a node object')
  const nodeName = name(node.name, 'node name')
  if (!Array.isArray(node.actions) || !node.actions.length) throw new Error(nodeName + ' needs at least one action.')
  const actions = node.actions.map(readAction)
  if (new Set(actions.map(action => action.label)).size !== actions.length) throw new Error(nodeName + ' has duplicate action labels.')
  if (!Array.isArray(node.combos)) throw new Error(nodeName + ' needs a list of combos.')

  const combos: FlopCombo[] = []
  const seen = new Set<string>()
  for (const entry of node.combos) {
    const combo = record(entry, 'a combo object')
    const hole = cardsFor(combo.hand, 'hole cards', 2)
    const hand = hole.map(cardText).join('')
    const { weight, frequencies, evs } = combo
    if (seen.has(hand)) throw new Error(nodeName + ' repeats ' + hand + '.')
    seen.add(hand)
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error(hand + ' needs a weight between 0 and 1.')
    }
    if (!weight || hole.some(card => board.includes(card))) continue
    if (!Array.isArray(frequencies) || frequencies.length !== actions.length ||
      frequencies.some(frequency => typeof frequency !== 'number' || !Number.isFinite(frequency) || frequency < 0 || frequency > 100) ||
      frequencies.reduce((sum, frequency) => sum + frequency, 0) > 100.1) {
      throw new Error(hand + ' needs one frequency from 0–100 per action, totaling at most 100% apart from rounding.')
    }
    if (evs !== undefined && (!Array.isArray(evs) || evs.length !== actions.length ||
      evs.some(ev => ev !== null && (typeof ev !== 'number' || !Number.isFinite(ev))))) {
      throw new Error(hand + ' needs one numeric or null EV per action.')
    }
    combos.push({ hand, weight, frequencies, ...(evs === undefined ? {} : { evs }) })
  }
  return { name: nodeName, actions, combos }
}

export function readFlopSpot(value: unknown): FlopSpot {
  const spot = record(value, 'a flop spot object')
  const configuration = name(spot.configuration, 'configuration')
  if (configuration.length > 120) throw new Error('Configuration names can be up to 120 characters.')
  const board = cardsFor(spot.board, 'the flop', 3)
  if (!Array.isArray(spot.nodes) || !spot.nodes.length) throw new Error('Each flop needs at least one node.')
  const nodes = spot.nodes.map(node => readNode(node, board))
  if (new Set(nodes.map(node => node.name)).size !== nodes.length) throw new Error('Node names must be unique within a flop.')
  return { configuration, board: board.map(cardText).join(''), nodes }
}

function numberFromText(value: string | undefined) {
  return value?.trim() ? Number(value) : NaN
}

function readLegacySpots(text: string) {
  const [header, ...lines] = text.split(/\r?\n/)
  const columns = header.split('\t').map(field => field.trim())
  const required = (field: string) => {
    const index = columns.indexOf(field)
    if (index < 0) throw new Error('Missing ' + field + ' column.')
    return index
  }
  const configuration = required('Configuration')
  const board = required('Board')
  const groups = columns.flatMap((column, index) => {
    const suffix = /^NodeName(\d+)$/.exec(column)?.[1]
    return suffix ? [{ index, suffix }] : []
  })
  if (!groups.length) throw new Error('Missing NodeName columns.')

  return lines.flatMap((line, index) => {
    if (!line.trim()) return []
    const row = line.split('\t')
    try {
      const nodes = groups.flatMap(({ index, suffix }): FlopNode[] => {
        const nodeName = row[index]?.trim()
        if (!nodeName) return []
        const colors = name(row[required('RangeColors' + suffix)], 'range colors').split(',').map(color => color.trim())
        const weights = name(row[required('PreflopRange' + suffix)], 'preflop range').split(/\s+/).map(Number)
        if (weights.length !== 1326 || weights.some(weight => !Number.isFinite(weight) || weight < 0 || weight > 1)) {
          throw new Error(nodeName + ' needs 1,326 weights between 0 and 1.')
        }
        const combos = (row[required('Freqs' + suffix)] ?? '').split('*').filter(entry => entry.trim()).map(entry => {
          const [hand, ...values] = entry.split(',')
          const [high, low] = cardsFor(hand, 'hole cards', 2)
          const count = colors.length
          // The legacy vector lists pairs in ascending order of the higher card, then the lower card.
          const weight = weights[high * (high - 1) / 2 + low]
          return {
            hand, weight,
            frequencies: Array.from({ length: count }, (_, index) => numberFromText(values[index])),
            evs: Array.from({ length: count }, (_, index) => {
              const value = values[count + index]
              return !value?.trim() || /^nan$/i.test(value.trim()) ? null : Number(value)
            }),
          }
        })
        return [{ name: nodeName, actions: colors.map((color, index) => ({ label: 'Action ' + (index + 1), color })), combos }]
      })
      return [readFlopSpot({ configuration: row[configuration]?.trim() || 'General', board: row[board], nodes })]
    } catch (error) {
      throw new Error('Row ' + (index + 2) + '. ' + (error as Error).message)
    }
  })
}

export function parseFlopImport(input: string) {
  const text = input.trimStart()
  let spots: FlopSpot[]
  if (text.startsWith('[') || text.startsWith('{')) {
    const json: unknown = JSON.parse(text)
    spots = (Array.isArray(json) ? json : [json]).map(readFlopSpot)
  } else {
    spots = readLegacySpots(text)
  }
  if (!spots.length) throw new Error('The file has no flop spots.')
  const keys = new Set(spots.map(spot => JSON.stringify([spot.configuration, spot.board])))
  if (keys.size !== spots.length) throw new Error('The file repeats a flop within the same configuration.')
  return spots
}
