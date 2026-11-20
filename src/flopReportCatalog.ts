export type FlopReportGroup = 'srp' | '3bet-ip' | '3bet-oop'

export const flopReportLines = {
  'cbet': 'C-bet',
  'vs-b33': 'Facing B33',
  'vs-b66': 'Facing B66',
  'vs-b130': 'Facing B130',
  'vs-check': 'After check',
  'x-vs-b33': 'X vs B33',
  'x-vs-b66': 'X vs B66',
} as const

export type FlopReportLine = keyof typeof flopReportLines
type Matchup = { id: string; label: string; lines: FlopReportLine[] }

export const flopReportGroups: { id: FlopReportGroup; label: string; matchups: Matchup[] }[] = [
  {
    id: 'srp', label: 'SRP', matchups: [
      { id: 'utg-bb', label: 'UTG vs BB', lines: ['cbet', 'vs-b33', 'vs-b66'] },
      { id: 'mp-bb', label: 'MP vs BB', lines: ['cbet', 'vs-b33', 'vs-b66'] },
      { id: 'co-bb', label: 'CO vs BB', lines: ['cbet', 'vs-b33', 'vs-b66'] },
      { id: 'bu-bb', label: 'BU vs BB', lines: ['cbet', 'vs-b33', 'vs-b66'] },
      { id: 'sb-bb', label: 'SB vs BB', lines: ['cbet', 'vs-b33', 'vs-b66', 'vs-b130', 'vs-check'] },
    ],
  },
  {
    id: '3bet-ip', label: '3-bet IP', matchups: [
      { id: 'utg-mp', label: 'UTG vs MP', lines: ['cbet', 'vs-b33', 'vs-b66'] },
      { id: 'utg-co', label: 'UTG vs CO', lines: ['cbet', 'vs-b33', 'vs-b66'] },
      { id: 'utg-bu', label: 'UTG vs BU', lines: ['cbet', 'vs-b33', 'vs-b66'] },
      { id: 'mp-co', label: 'MP vs CO', lines: ['cbet', 'vs-b33', 'vs-b66'] },
      { id: 'mp-bu', label: 'MP vs BU', lines: ['cbet', 'vs-b33', 'vs-b66'] },
      { id: 'co-bu', label: 'CO vs BU', lines: ['cbet', 'vs-b33', 'vs-b66'] },
      { id: 'sb-bb', label: 'SB vs BB', lines: ['cbet', 'vs-b33', 'vs-b66'] },
    ],
  },
  {
    id: '3bet-oop', label: '3-bet OOP', matchups: [
      { id: 'utg-bb', label: 'UTG vs BB', lines: ['cbet', 'vs-b33', 'vs-b66', 'vs-check', 'x-vs-b33', 'x-vs-b66'] },
      { id: 'mp-bb', label: 'MP vs BB', lines: ['cbet', 'vs-b33', 'vs-b66', 'vs-check', 'x-vs-b33', 'x-vs-b66'] },
      { id: 'co-bb', label: 'CO vs BB', lines: ['cbet', 'vs-b33', 'vs-b66', 'vs-check', 'x-vs-b33', 'x-vs-b66'] },
      { id: 'bu-bb', label: 'BU vs BB', lines: ['cbet', 'vs-b33', 'vs-b66', 'vs-check', 'x-vs-b33', 'x-vs-b66'] },
      { id: 'utg-sb', label: 'UTG vs SB', lines: ['cbet', 'vs-b33', 'vs-b66', 'vs-check', 'x-vs-b33', 'x-vs-b66'] },
      { id: 'mp-sb', label: 'MP vs SB', lines: ['cbet', 'vs-b33', 'vs-b66', 'vs-check', 'x-vs-b33', 'x-vs-b66'] },
      { id: 'co-sb', label: 'CO vs SB', lines: ['cbet', 'vs-b33', 'vs-b66', 'vs-check', 'x-vs-b33', 'x-vs-b66'] },
      { id: 'bu-sb', label: 'BU vs SB', lines: ['cbet', 'vs-b33', 'vs-b66', 'vs-check', 'x-vs-b33', 'x-vs-b66'] },
    ],
  },
]
