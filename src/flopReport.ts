import { readCards } from './cards.ts'

const textures = {
  'rainbow-disconnected': 'Rainbow disconnected',
  'rainbow-connected': 'Rainbow connected',
  'two-tone-disconnected': 'Two-tone disconnected',
  'two-tone-connected': 'Two-tone connected',
  monotone: 'Monotone',
  trips: 'Trips',
  'paired-rainbow': 'Paired rainbow',
  'paired-two-tone': 'Paired two-tone',
} as const

type Texture = keyof typeof textures

export type FlopBoard = {
  code: string
  cards: number[]
  groupRank: number
  frequencies: number[]
  ipEv: number | null
  oopEv: number | null
}

export type FlopTextureGroup = { id: Texture; label: string; boards: FlopBoard[] }
export type FlopAction = { label: string; color: string }

const actionColors: Record<string, string> = {
  Fold: '#5488cf',
  Call: '#278352',
  Check: '#278352',
  AI: '#7d90a8',
}
const raiseColors = ['#a83a91', '#d954ac', '#f67eca', '#ffaddf']

function colorForAction(label: string, raiseIndex: number) {
  if (label.startsWith('R')) return raiseColors[raiseIndex % raiseColors.length]
  if (label.startsWith('B')) {
    const percent = Number(label.slice(1))
    return percent <= 40 ? '#d47c29' : percent <= 100 ? '#cc4152' : '#9462cc'
  }
  return actionColors[label]
}

export function flopTexture(cards: number[]): { texture: Texture; groupRank: number } {
  const [high, middle, low] = cards.map(card => card >> 2).sort((a, b) => b - a)
  const suitCount = new Set(cards.map(card => card & 3)).size
  if (high === low) return { texture: 'trips', groupRank: high }
  if (high === middle || middle === low) {
    return { texture: suitCount === 3 ? 'paired-rainbow' : 'paired-two-tone', groupRank: middle }
  }
  if (suitCount === 1) return { texture: 'monotone', groupRank: high }
  // The three ranks must fit a five-card straight window. Ace can play low in A2345.
  const connected = high - low <= 4 || (high === 12 && middle <= 3)
  const texture = suitCount === 3
    ? (connected ? 'rainbow-connected' : 'rainbow-disconnected')
    : (connected ? 'two-tone-connected' : 'two-tone-disconnected')
  return { texture, groupRank: high }
}

function parseEv(value: string) {
  if (!value) return null
  const ev = Number(value)
  if (!Number.isFinite(ev)) throw new Error('Invalid expected value.')
  return ev
}

function parseFrequency(value: string) {
  const frequency = value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value)
  if (!value || !Number.isFinite(frequency) || frequency < 0 || frequency > 1) {
    throw new Error('Invalid action frequency.')
  }
  return frequency
}

function byRankThenBoard(a: FlopBoard, b: FlopBoard) {
  return b.groupRank - a.groupRank
    || (b.cards[0] >> 2) - (a.cards[0] >> 2)
    || (b.cards[1] >> 2) - (a.cards[1] >> 2)
    || (b.cards[2] >> 2) - (a.cards[2] >> 2)
    || a.code.localeCompare(b.code)
}

// The flop exports use unquoted comma-separated fields with one board per line.
export function parseFlopReport(text: string) {
  const [header, ...lines] = text.trim().split(/\r?\n/)
  const fields = header.split(',').map(field => field.trim())
  const flopIndex = fields.indexOf('flop')
  const ipEvIndex = fields.indexOf('ip_ev')
  const oopEvIndex = fields.indexOf('oop_ev')
  const indices = fields.flatMap((field, index) => /^(?:Check|Call|Fold|AI|[BR]\d+)$/.test(field) ? [index] : [])
  if (flopIndex < 0 || ipEvIndex < 0 || oopEvIndex < 0 || !indices.length) {
    throw new Error('Missing board, action, or EV columns.')
  }

  let raiseIndex = 0
  const actions: FlopAction[] = indices.map(index => {
    const label = fields[index]
    return { label, color: colorForAction(label, label.startsWith('R') ? raiseIndex++ : 0) }
  })
  const groups = (Object.keys(textures) as Texture[]).map((id): FlopTextureGroup => ({ id, label: textures[id], boards: [] }))
  const byTexture = new Map(groups.map(group => [group.id, group.boards]))
  let boardCount = 0

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    try {
      const values = line.split(',').map(field => field.trim())
      if (values.length !== fields.length) throw new Error('Unexpected column count.')
      const code = values[flopIndex]
      const cards = readCards(code).sort((a, b) => (b >> 2) - (a >> 2))
      if (cards.length !== 3 || new Set(cards).size !== 3) throw new Error('Invalid flop.')
      const frequencies = indices.map(column => parseFrequency(values[column]))
      if (Math.abs(frequencies.reduce((sum, frequency) => sum + frequency, 0) - 1) > .001) {
        throw new Error('Action frequencies do not add up to 100%.')
      }
      const { texture, groupRank } = flopTexture(cards)
      byTexture.get(texture)!.push({
        code, cards, groupRank, frequencies, ipEv: parseEv(values[ipEvIndex]), oopEv: parseEv(values[oopEvIndex]),
      })
      boardCount++
    } catch (error) {
      throw new Error('Report row ' + (index + 2) + '. ' + (error as Error).message)
    }
  }

  if (!boardCount) throw new Error('This report has no flop boards.')
  for (const { boards } of groups) boards.sort(byRankThenBoard)
  return { groups, actions, boardCount }
}
