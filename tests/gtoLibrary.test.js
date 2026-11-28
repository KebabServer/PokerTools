import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { readCards } from '../src/cards.ts'
import { startingHandName } from '../src/ranges.ts'
import { dealGtoFlop, gtoLegalMoves, gtoMatchup, gtoPlayer, playGtoMove, startGtoGame } from '../src/gtoGame.ts'
import {
  advanceGtoNode, attachGtoFlop, createGtoRoot, currentGtoNode, followGtoBranch, gtoBoardKey,
  interpretGtoAction, jumpGtoNode, makeGtoStudy, simpleGtoPresetName,
} from '../src/gtoPreflop.ts'
import { mixForHand, parsePreflopPresets, preflopCombos, preflopHands, preflopPositions } from '../src/preflop.ts'
import { readStudySnapshot } from './studySnapshot.js'

const source = readStudySnapshot('preflop-ranges.tsv')
const fingerprint = createHash('sha256').update(source).digest('hex')
const preset = parsePreflopPresets(source).find(item => item.name === simpleGtoPresetName)
const study = makeGtoStudy(preset, fingerprint)
const fold = { kind: 'fold' }, call = { kind: 'call' }, check = { kind: 'check' }, allIn = { kind: 'all-in' }
const raise = to => ({ kind: 'raise', to })
const play = (game, ...moves) => moves.reduce(playGtoMove, game)
const root = () => createGtoRoot(study)
const branch = (node, move) => node.branches.find(item =>
  item.move.kind === move.kind && (move.kind !== 'raise' || item.move.to === move.to))
const follow = (node, ...moves) => moves.reduce((current, move) => followGtoBranch(current, branch(current, move).childId, study), node)
const comboIndex = text => {
  const [a, b] = readCards(text).sort((x, y) => x - y)
  return preflopCombos.findIndex(([low, high]) => low === a && high === b)
}

test('six-player blinds, folds and the BB option preserve clockwise order and conservation', () => {
  let game = startGtoGame()
  const seen = []
  for (const move of [call, call, call, call, call, check]) {
    seen.push(game.actor)
    game = playGtoMove(game, move)
  }
  assert.deepEqual(seen, ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'])
  assert.equal(game.phase, 'awaiting-flop')
  assert.equal(game.pot, 600)
  assert.equal(gtoMatchup(game).headsUp, false)
  assert.equal(game.players.reduce((total, seat) => total + seat.stack, game.pot), 60_000)
  const flop = dealGtoFlop(game, readCards('AhJd4s'))
  assert.equal(flop.actor, 'SB')
  assert.equal(flop.players.length, 6)
  assert.throws(() => dealGtoFlop(game, readCards('AhAh4s')), /different cards/)
  assert.throws(() => dealGtoFlop(startGtoGame(), readCards('AhJd4s')), /Complete preflop/)
})

test('raise-to, all-in, short calls, and returned bets keep exact stacks', () => {
  const opened = play(startGtoGame(), raise(250))
  assert.equal(opened.pot, 400)
  assert.equal(opened.minRaise, 150)
  assert.equal(opened.actor, 'MP')
  assert.throws(() => playGtoMove(opened, raise(399)), /unavailable/)
  const jam = play(opened, allIn, fold, fold, fold, fold, call)
  assert.equal(jam.phase, 'awaiting-flop')
  assert.equal(jam.pot, 20_150)
  assert.equal(gtoPlayer(jam, 'UTG').stack, 0)
  assert.equal(gtoPlayer(jam, 'MP').stack, 0)
  assert.equal(dealGtoFlop(jam, readCards('AsKs4c')).actor, null)
  const won = play(startGtoGame(), allIn, fold, fold, fold, fold, fold)
  assert.equal(won.phase, 'uncontested')
  assert.equal(won.pot, 250)
  assert.equal(gtoPlayer(won, 'UTG').stack, 9900)
  assert.deepEqual(gtoLegalMoves(won), [])
  const shortCall = play(startGtoGame(undefined, { MP: 300 }), allIn, call, fold, fold, fold, fold)
  assert.equal(gtoPlayer(shortCall, 'UTG').stack, 9700)
  assert.equal(shortCall.pot, 750)
  const shortRaise = play(startGtoGame(undefined, { MP: 300 }), raise(250), allIn, call, fold, fold, fold)
  assert.equal(shortRaise.actor, 'UTG')
  assert.equal(shortRaise.minRaise, 150)
  assert.deepEqual(gtoLegalMoves(shortRaise, [450]), [fold, call])
  assert.equal(playGtoMove(shortRaise, call).pot, 1050)
})

test('exact combo conversion retains every exported value and reproduces the Viewer averages', () => {
  const [heading, ...rows] = source.trimEnd().split(/\r?\n/)
  const columns = heading.split('\t')
  assert.equal(preflopCombos.length, 1326)
  assert.equal(new Set(preflopCombos.map(cards => cards.join('-'))).size, 1326)
  for (const line of rows) {
    const row = line.split('\t')
    if (row[0] !== preset.name) continue
    const actions = preset.ranges.get(row.slice(1, 4).join('/'))
    for (const action of actions) {
      const index = columns.findIndex((name, i) => /^Action\d+$/.test(name) && row[i] === action.label)
      const raw = row[index + 1].trim().split(/\s+/).map(Number)
      const counts = new Uint16Array(169), sums = new Float64Array(169)
      preflopCombos.forEach(([low, high], i) => {
        const expected = raw[high * (high - 1) / 2 + low]
        assert.equal(action.comboFrequencies[i], expected)
        const hand = preflopHands.indexOf(startingHandName(low, high))
        counts[hand]++
        sums[hand] += expected
      })
      for (let h = 0; h < sums.length; h++) assert.ok(Math.abs(sums[h] / counts[h] - action.frequencies[h]) < 1e-12)
    }
  }
  assert.equal(fingerprint, 'd49e18b0a993116ae177dfe51e12c3d30f9785cfe9b0650ec9381850fa4ea211')
  assert.equal(root().strategy.source.fingerprint, fingerprint)
})

test('RFI, heads-up responses and flop blockers use the same unmodified strategy vectors', () => {
  const start = root()
  const initial = start.strategy
  assert.equal(initial.spot, '2Bet/UTG/UTG')
  const a5o = preflopHands.indexOf('A5o')
  assert.deepEqual(mixForHand(initial.actions, a5o).map(item => [item.label, item.frequency]),
    [['Raise 2.5bb', 0], ['Unlisted', 1]])
  assert.equal(branch(start, fold).sourceAction, null)
  assert.equal(branch(start, fold).rangeFrequency, null)
  const btn = follow(start, fold, fold, fold)
  assert.equal(btn.game.actor, 'BTN')
  assert.equal(btn.strategy.spot, '2Bet/BTN/BTN')
  const versus = follow(btn, raise(250), fold)
  assert.equal(versus.strategy.spot, '3Bet/BTN/BB')
  const flop = follow(versus, call)
  assert.equal(flop.game.pot, 550)
  assert.equal(gtoMatchup(flop.game).effectiveStack, 9750)
  assert.deepEqual(gtoMatchup(flop.game).players.map(seat => seat.position), ['BB', 'BTN'])
  assert.equal(gtoMatchup(flop.game).headsUp, true)
  assert.strictEqual(flop.incomingRanges.BB.weights, branch(versus, call).sourceAction.comboFrequencies)
  const board = readCards('As8h3d')
  const dealt = attachGtoFlop(flop, board)
  assert.equal(dealt.game.actor, 'BB')
  assert.equal(dealt.parentId, flop.id)
  assert.equal(gtoBoardKey(board), gtoBoardKey([...board].reverse()))
  const blocked = comboIndex('AsKs'), legal = comboIndex('AhKh')
  assert.ok(flop.incomingRanges.BTN.weights[blocked] > 0)
  assert.equal(dealt.incomingRanges.BTN.weights[blocked], 0)
  assert.equal(dealt.incomingRanges.BTN.weights[legal], flop.incomingRanges.BTN.weights[legal])
})

test('every Simple row is reachable at the exported position and sizing', () => {
  function foldTo(node, position) {
    while (node.game.actor !== position && node.game.actor) node = follow(node, fold)
    assert.equal(node.game.actor, position)
    return node
  }
  const reached = new Set()
  for (const [spot, context] of preset.contexts) {
    const [stage, opener, responder] = spot.split('/')
    let node = foldTo(root(), opener)
    if (stage !== '2Bet') {
      const open = context.investedBb[preflopPositions.indexOf(opener)] * 100
      node = foldTo(follow(node, raise(open)), responder)
    }
    if (stage === '4Bet') {
      const threeBet = context.investedBb[preflopPositions.indexOf(responder)] * 100
      node = foldTo(follow(node, raise(threeBet)), opener)
      assert.equal(node.strategy.basis, opener === 'SB' ? 'unverified' : 'opening-range')
    }
    assert.equal(node.strategy.spot, spot)
    assert.strictEqual(node.strategy.actions, preset.ranges.get(spot))
    reached.add(spot)
  }
  assert.equal(reached.size, 35)
})

test('4-bet reply exports preserve reach and leave subsequent defense unseeded', () => {
  const reply = follow(root(), raise(250), raise(750), fold, fold, fold, fold)
  assert.equal(reply.strategy.spot, '4Bet/UTG/MP')
  assert.equal(reply.strategy.basis, 'opening-range')
  const index = comboIndex('2c2d')
  const continuation = branch(reply, call)
  assert.equal(reply.incomingRanges.UTG.weights[index], .26)
  assert.equal(continuation.sourceAction.comboFrequencies[index], .26)
  assert.equal(follow(reply, call).incomingRanges.UTG.weights[index], .26)
  assert.equal(follow(reply, call).game.pot, 1650)
  const defense = follow(reply, raise(2000))
  assert.equal(defense.strategy.status, 'missing')
  assert.equal(branch(defense, call).sourceAction, null)
  assert.equal(follow(defense, call).incomingRanges.MP, null)
})

test('mismatched opening sizes and cold calls cannot borrow an exported matchup', () => {
  const sb = follow(root(), fold, fold, fold, fold)
  const badSize = follow(sb, raise(250))
  assert.equal(badSize.strategy.status, 'missing')
  assert.equal(branch(badSize, call).rangeFrequency, null)
  assert.equal(branch(sb, raise(300)).sourceAction, null)
  const recordedSize = follow(sb, raise(300))
  assert.equal(recordedSize.strategy.spot, '3Bet/SB/BB')
  assert.equal(recordedSize.incomingRanges.SB, null)
  const cold = follow(root(), raise(250), call)
  assert.equal(cold.strategy.status, 'missing')
  const multiway = follow(cold, fold, fold, fold, call)
  assert.equal(multiway.game.pot, 800)
  assert.equal(gtoMatchup(multiway.game).headsUp, false)
  assert.equal(multiway.incomingRanges.MP, null)
})

test('conditional and multi-decision labels cannot become immediate betting moves', () => {
  for (const label of ['R7.5bb/C', 'R7.5bb/F', 'R11bb/AI', 'R2.25bb/4b', 'R/R27bb']) {
    assert.equal(interpretGtoAction(label, 100), null)
  }
  assert.deepEqual(interpretGtoAction('Raise 2.5bb', 100), raise(250))
  assert.deepEqual(interpretGtoAction('All In', 100), allIn)
  const ranges = new Map(preset.ranges)
  const [action] = ranges.get('2Bet/UTG/UTG')
  ranges.set('2Bet/UTG/UTG', [{ ...action, label: 'R2.5bb/C' }])
  const node = createGtoRoot(makeGtoStudy({ ...preset, ranges }, fingerprint))
  assert.equal(node.strategy.hasUnmapped, true)
  assert.ok(node.branches.every(branch => branch.sourceAction === null))
})

test('navigation rewinds to the original pot, keeps the forward path, and forks on a new action', () => {
  const start = root()
  const folded = follow(start, fold)
  const opened = follow(start, raise(250))
  const after = advanceGtoNode({ nodes: [start], cursor: 0 }, opened)
  const back = jumpGtoNode(after, 0)
  assert.equal(currentGtoNode(back).game.pot, 150)
  assert.equal(currentGtoNode(jumpGtoNode(back, 1)).game.pot, 400)
  assert.strictEqual(currentGtoNode(advanceGtoNode(back, follow(start, raise(250)))), opened)
  assert.deepEqual(advanceGtoNode(back, folded).nodes.map(node => node.id), [start.id, folded.id])
  assert.equal(folded.parentId, start.id)
  assert.throws(() => advanceGtoNode(after, folded), /another node/)
})
