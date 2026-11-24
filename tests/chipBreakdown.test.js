import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chipBreakdown } from '../src/chipBreakdown.ts'

test('decomposes replay amounts into the requested denominations and the exact fractional remainder', () => {
  const piles = chipBreakdown(2_463_783)
  assert.deepEqual(piles.map(({ value, color, count }) => [value, color, count]), [
    [100_000, 'orange', 24], [50_000, 'purple', 1], [10_000, 'black', 1],
    [2_500, 'green', 1], [500, 'red', 2], [100, 'white', 2], [83, 'fraction', 1],
  ])
})

test('the displayed piles add up exactly at blind, fraction and high stack sizes', () => {
  for (const amount of [0, 1, 25, 99, 100, 500, 2500, 10_000, 50_000, 100_000, 123_456, 9_999_999_999_999]) {
    const piles = chipBreakdown(amount)
    assert.equal(piles.reduce((sum, { value, count }) => sum + value * count, 0), amount)
    assert.ok(piles.every(({ count }) => Number.isInteger(count) && count > 0))
  }
  assert.deepEqual(chipBreakdown(0), [])
})
