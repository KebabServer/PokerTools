import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readCards } from '../src/cards.ts'
import { flopTexture, parseFlopReport } from '../src/flopReport.ts'
import { flopReportGroups } from '../src/flopReportCatalog.ts'
import { flopSizingQuestions } from '../src/flopSizingTrainer.ts'
import { convertFourBetReport } from '../scripts/convert-4bet-reports.mjs'
import { readStudySnapshot, reportSnapshotNames } from './studySnapshot.js'

const readReport = file => parseFlopReport(readStudySnapshot('flop-reports/' + file + '.csv'))

test('each original matchup and line has a complete report of 1,755 distinct solver flops', () => {
  const groups = flopReportGroups.filter(group => !group.id.startsWith('4bet-'))
  const files = groups.flatMap(group => group.matchups.flatMap(matchup =>
    matchup.lines.map(line => `${group.id}-${matchup.id}-${line}.csv`)
  ))
  assert.equal(files.length, 86)
  assert.deepEqual(files.sort(), reportSnapshotNames().sort())
  for (const file of files) {
    const report = parseFlopReport(readStudySnapshot('flop-reports/' + file))
    const boards = report.groups.flatMap(group => group.boards)
    assert.equal(report.boardCount, 1755, file)
    assert.equal(new Set(boards.map(board => board.code)).size, 1755, file)
    assert.ok(report.groups.every(group => group.boards.length > 0), file)
  }
})

test('flop textures distinguish wheel boards, trips, and the rank of a pair', () => {
  assert.equal(flopTexture(readCards('Ah5d2c')).texture, 'rainbow-connected')
  assert.equal(flopTexture(readCards('Ah6d2c')).texture, 'rainbow-disconnected')
  assert.equal(flopTexture(readCards('AhThJd')).texture, 'two-tone-connected')
  assert.equal(flopTexture(readCards('Ah9hJd')).texture, 'two-tone-disconnected')
  assert.equal(flopTexture(readCards('AhThJh')).texture, 'monotone')
  assert.equal(flopTexture(readCards('AdAhAs')).texture, 'trips')
  assert.deepEqual(flopTexture(readCards('Ah9d9c')), { texture: 'paired-rainbow', groupRank: 7 })
  assert.deepEqual(flopTexture(readCards('Ah9h9c')), { texture: 'paired-two-tone', groupRank: 7 })
})

test('the repaired BTN reports retain both raises and all-in frequencies', () => {
  for (const [line, code, allIn] of [['b33', '7h3d2c', .00002], ['b66', '4h3h2h', .00063]]) {
    const { actions, groups } = readReport('srp-bu-bb-vs-' + line)
    assert.deepEqual(actions.map(action => action.label), ['Fold', 'Call', 'R50', 'R100', 'AI'])
    assert.equal(groups.flatMap(group => group.boards).find(board => board.code === code).frequencies.at(-1), allIn)
  }
})

test('3-bet IP facing B66 loads the selected matchup and preserves missing EVs', () => {
  const utg = readReport('3bet-ip-utg-bu-vs-b66')
  const co = readReport('3bet-ip-co-bu-vs-b66')
  assert.equal(utg.groups[0].boards[0].ipEv, 23.9927)
  assert.equal(co.groups[0].boards[0].ipEv, 24.3193)
  const missing = utg.groups.flatMap(group => group.boards).find(board => board.code === '7h3h2h')
  assert.equal(missing.ipEv, null)
  assert.equal(missing.oopEv, null)
  assert.equal(missing.frequencies[0], .50551)
})

test('the trainer grades the most-used bet size and skips flops with no bets', () => {
  const report = parseFlopReport([
    'flop,ip_ev,oop_ev,Check,B33,B66,AI',
    'Ah8d3c,,,0.75,0.1,0.15,0',
    'Kh8d3c,,,1,0,0,0',
  ].join('\n'))
  const { choices, questions } = flopSizingQuestions(report)
  assert.deepEqual(choices.map(index => report.actions[index].label), ['B33', 'B66', 'AI'])
  assert.deepEqual(questions.map(({ board, best }) => [board.code, best]), [['Ah8d3c', [2]]])
})

test('the trainer accepts tied raise sizes and can prefer all-in', () => {
  const report = parseFlopReport([
    'flop,ip_ev,oop_ev,Fold,Call,R50,R100,AI',
    'Ah8d3c,,,0.45,0.35,0.1,0.1,0',
    'Kh8d3c,,,0.3,0.2,0.1,0.1,0.3',
  ].join('\n'))
  const { choices, questions } = flopSizingQuestions(report)
  assert.deepEqual(choices.map(index => report.actions[index].label), ['R50', 'R100', 'AI'])
  assert.deepEqual(questions.map(({ board, best }) => [board.code, best]), [
    ['Ah8d3c', [2, 3]], ['Kh8d3c', [4]],
  ])
})

test('the trainer requires a choice between multiple sizes', () => {
  const report = parseFlopReport('flop,ip_ev,oop_ev,Check,B33\nAh8d3c,,,0.5,0.5')
  assert.deepEqual(flopSizingQuestions(report).questions, [])
})

function fourBetExport({ actor, ip, oop, bets }) {
  const actions = [
    { code: 'X', display_name: 'CHECK' },
    ...bets.map(([code, ratio]) => ({ code, display_name: 'BET', betsize_by_pot: ratio })),
    { code: 'RAI', display_name: 'ALLIN' },
  ]
  return {
    status: 'done',
    players: [{ position: ip, relative_position: 'IP' }, { position: oop, relative_position: 'OOP' }],
    game_point: {
      game: { active_position: actor, current_street: { type: 'FLOP' } },
      available_actions: actions.map(action => ({ action })),
    },
    solutions: [{
      name: '2h2d2c',
      player_solutions: [{ position: ip, ev: 28, eq: .6, eqr: 1.2 }, { position: oop, ev: 14, eq: .4, eqr: .9 }],
      action_solutions: actions.map(({ code }, index) => ({
        action_code: code, frequency: index === 1 ? .875 : index === actions.length - 1 ? .125 : 0,
      })).reverse(),
    }],
  }
}

test('4-bet conversion keeps legacy columns, solver sizing, and IP/OOP EVs', () => {
  const exportData = fourBetExport({
    actor: 'UTG', ip: 'UTG', oop: 'BB', bets: [['R14.7', '0.3303'], ['R29.35', '0.65955']],
  })
  const { file, csv } = convertFourBetReport(exportData)
  assert.equal(file, '4bet-ip-utg-bb-cbet.csv')
  const [header, row] = csv.trim().split('\n')
  assert.equal(header, 'oop_ev,oop_eq,ip_ev,ip_eq,oop_eqr,ip_eqr,actions/0/action_code,Check,actions/1/action_code,B33,actions/2/action_code,B66,actions/3/action_code,AI,flop')
  assert.equal(row, '14,0.4,28,0.6,0.9,1.2,X,0,R14.7,0.875,R29.35,0,RAI,0.125,2h2d2c')
  const parsed = parseFlopReport(csv)
  const board = parsed.groups.find(group => group.id === 'trips').boards[0]
  assert.deepEqual([board.ipEv, board.oopEv, board.frequencies], [28, 14, [0, .875, 0, .125]])
})

test('4-bet conversion recognizes OOP position aliases and keeps adjacent bet sizes distinct', () => {
  const exportData = fourBetExport({
    actor: 'HJ', ip: 'BTN', oop: 'HJ', bets: [['R4.15', '.1'], ['R10.4', '.2506'], ['R20.75', '.5'], ['R31.1', '.7494']],
  })
  const { file, csv } = convertFourBetReport(exportData)
  assert.equal(file, '4bet-oop-mp-bu-cbet.csv')
  const { actions } = parseFlopReport(csv)
  assert.deepEqual(actions.map(action => action.label), ['Check', 'B10', 'B25', 'B50', 'B75', 'AI'])
  assert.equal(new Set(actions.map(action => action.color)).size, actions.length)
  exportData.solutions[0].action_solutions.pop()
  assert.throws(() => convertFourBetReport(exportData), /Unexpected actions/)
})
