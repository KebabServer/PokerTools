import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readCards } from '../src/cards.ts'
import { flopTexture, parseFlopReport } from '../src/flopReport.ts'
import { flopReportGroups } from '../src/flopReportCatalog.ts'
import { readStudySnapshot, reportSnapshotNames } from './studySnapshot.js'

const readReport = file => parseFlopReport(readStudySnapshot('flop-reports/' + file + '.csv'))

test('each matchup and line has a complete report of 1,755 distinct solver flops', () => {
  const files = flopReportGroups.flatMap(group => group.matchups.flatMap(matchup =>
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
