import type { FlopBoard, FlopReport } from './flopReport.ts'

export type FlopSizingQuestion = { board: FlopBoard; best: number[] }

export function flopActionBands(frequencies: number[]) {
  const total = frequencies.reduce((sum, frequency) => sum + frequency, 0)
  let cumulative = 0
  let start = 0
  return frequencies.flatMap((frequency, index) => {
    if (frequency === 0) return []
    cumulative += frequency
    // Match the precision shown in the trainer and avoid floating-point boundary errors.
    const end = Number((100 * cumulative / total).toFixed(3))
    const band = { index, start, end }
    start = end
    return end > band.start ? [band] : []
  })
}

export function bandForRoll(bands: ReturnType<typeof flopActionBands>, roll: number) {
  return bands.find(band => roll >= band.start && (roll < band.end || (roll === 100 && band.end === 100)))
}

export function flopSizingQuestions({ actions, groups }: FlopReport) {
  const choices = actions.flatMap((action, index) => /^(?:[BR]\d+|AI)$/.test(action.label) ? [index] : [])
  const questions: FlopSizingQuestion[] = []
  if (choices.length < 2) return { choices, questions }

  for (const { boards } of groups) {
    for (const board of boards) {
      const highest = Math.max(...choices.map(index => board.frequencies[index]))
      if (highest === 0) continue
      questions.push({
        board,
        best: choices.filter(index => board.frequencies[index] === highest),
      })
    }
  }
  return { choices, questions }
}
