import type { FlopBoard, FlopReport } from './flopReport.ts'

export type FlopSizingQuestion = { board: FlopBoard; best: number[] }

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
