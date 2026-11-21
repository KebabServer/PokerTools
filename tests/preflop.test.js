import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mixBackground, mixForHand, parsePreflopPresets, preflopHands, preflopSpotGroups } from '../src/preflop.ts'
import { readStudySnapshot } from './studySnapshot.js'

const source = readStudySnapshot('preflop-ranges.tsv')
const presets = parsePreflopPresets(source)
const dataFor = (preset, spot, hand) => mixForHand(
  presets.find(item => item.name === preset).ranges.get(spot),
  preflopHands.indexOf(hand),
)
const simple = 'GTOw 500nl Simple'

function roundedMix(mix) {
  return mix.map(({ label, frequency }) => [label, Math.round(frequency * 1000) / 1000])
}

test('all 140 spot rows match the position matrices, with absent ranges kept unavailable', () => {
  assert.deepEqual(presets.map(preset => preset.name), [simple, 'BTS Bible', 'Upswing Solver Old', 'GTOw 500nl 2.5 General'])
  const spots = preflopSpotGroups.flatMap(group => group.spots.map(spot => spot.id)).sort()
  assert.equal(spots.length, 35)
  for (const { ranges } of presets) assert.deepEqual([...ranges.keys()].sort(), spots)
  assert.deepEqual(presets.map(preset => [...preset.ranges.values()].filter(actions => actions.length).length), [35, 20, 35, 32])
  assert.deepEqual(dataFor('BTS Bible', '4Bet/UTG/MP', 'AA'), [])
  assert.deepEqual(dataFor('GTOw 500nl 2.5 General', '2Bet/SB/SB', 'AA'), [])
})

test('combo ordering preserves pairs, suited and offsuit hands, and mixed responses', () => {
  assert.equal(new Set(preflopHands).size, 169)
  assert.deepEqual(roundedMix(dataFor(simple, '2Bet/UTG/UTG', 'AA')), [['Raise 2.5bb', 1]])
  assert.deepEqual(roundedMix(dataFor(simple, '2Bet/UTG/UTG', 'A5s')), [['Raise 2.5bb', 1]])
  assert.deepEqual(roundedMix(dataFor(simple, '2Bet/UTG/UTG', 'A5o')), [['Raise 2.5bb', 0], ['Unlisted', 1]])
  assert.deepEqual(roundedMix(dataFor(simple, '3Bet/UTG/BB', 'A5s')), [['Raise 12bb', .355], ['Call', .645]])
  assert.deepEqual(roundedMix(dataFor(simple, '4Bet/UTG/MP', 'A5s')), [['Raise 20bb', .41], ['Call', .445], ['Fold', .145]])
})

test('the chart fits source totals above 100% while the readout keeps the exported values', () => {
  const mix = dataFor('Upswing Solver Old', '4Bet/BTN/SB', 'AA')
  assert.deepEqual(roundedMix(mix), [['R2.25bb/4b', 1], ['R2.25bb/C', .09], ['R2.25bb/F', 0]])
  assert.match(mixBackground(mix), /91\.743\d+%/)
  assert.match(mixBackground(mix), /100\.0000%\)$/)
})
