import { useMemo, useRef, useState } from 'react'
import { FlopActionLabel } from './FlopReportChart.tsx'
import { PlayingCard } from './PlayingCard.tsx'
import type { FlopReport } from './flopReport.ts'
import { bandForRoll, flopActionBands, flopSizingQuestions, type FlopSizingQuestion } from './flopSizingTrainer.ts'

const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 3 })
const list = new Intl.ListFormat('en')
const sizingLabel = (label: string) => label === 'AI' ? 'All-in' : label
const modes = ['Sizing', 'Roll'] as const
export type FlopTrainingMode = typeof modes[number]
type Question = FlopSizingQuestion | { board: FlopSizingQuestion['board']; roll: number }

type Quiz = {
  deck: Question[]
  index: number
  answer: number | null
  correct: number
}

function startQuiz(questions: Question[]): Quiz {
  const deck = questions.slice()
  for (let index = deck.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    const question = deck[index]
    deck[index] = deck[other]
    deck[other] = question
  }
  return { deck, index: 0, answer: null, correct: 0 }
}

function startRollQuiz(report: FlopReport) {
  return startQuiz(report.groups.flatMap(group => group.boards.map(board => ({
    board, roll: Math.floor(Math.random() * 101),
  }))))
}

export function FlopSizingTrainer({ report, mode, setMode }: {
  report: FlopReport
  mode: FlopTrainingMode
  setMode: (mode: FlopTrainingMode) => void
}) {
  const { actions } = report
  const { choices, questions } = useMemo(() => flopSizingQuestions(report), [report])
  const [quizzes, setQuizzes] = useState(() => ({ Sizing: startQuiz(questions), Roll: startRollQuiz(report) }))
  const quiz = quizzes[mode]
  const heading = useRef<HTMLHeadingElement>(null)
  const question = quiz.deck[quiz.index]
  const modeButtons = <div className="flop-report-tabs" role="group" aria-label="Training mode">
    {modes.map(item => <button type="button" key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{item}</button>)}
  </div>
  if (!question) return <section className="panel flop-trainer">
    {modeButtons}
    <p className="flop-report-status" role="status">This report has no sizing questions. Try Roll mode or choose another spot.</p>
  </section>

  const { board } = question
  const roll = 'roll' in question ? question.roll : null
  const bands = flopActionBands(board.frequencies)
  const rollBand = roll === null ? undefined : bandForRoll(bands, roll)
  const best = 'best' in question ? question.best : [rollBand!.index]
  const options = roll === null ? choices : actions.map((_, index) => index)
  const selected = quiz.answer
  const answered = selected !== null
  const isCorrect = answered && best.includes(selected)
  const atEnd = quiz.index === quiz.deck.length - 1
  const hasBets = actions.some(action => action.label.startsWith('B'))
  const hasRaises = actions.some(action => action.label.startsWith('R'))
  const sizing = hasBets === hasRaises ? 'sizing' : hasBets ? 'bet size' : 'raise size'
  const bestLabels = list.format(best.map(index => sizingLabel(actions[index].label)))
  const colorStops = bands.map(({ index, start, end }) => `${actions[index].color} ${start}% ${end}%`)
  const gradient = bands.length === 1 ? actions[bands[0].index].color : `linear-gradient(to right, ${colorStops.join(', ')})`
  const feedback = rollBand
    ? `${bestLabels} covers ${rollBand.start}–${rollBand.end}.`
    : `${bestLabels}${best.length > 1 ? ' tie at ' : ' is used most at '}${percent.format(board.frequencies[best[0]])}.`

  function answer(index: number) {
    setQuizzes(previous => {
      const current = previous[mode]
      if (current.answer !== null) return previous
      return { ...previous, [mode]: { ...current, answer: index, correct: current.correct + Number(best.includes(index)) } }
    })
  }

  function advance() {
    const next = atEnd
      ? mode === 'Roll' ? startRollQuiz(report) : startQuiz(questions)
      : { ...quiz, index: quiz.index + 1, answer: null }
    setQuizzes(previous => ({ ...previous, [mode]: next }))
    heading.current?.focus()
  }

  return <section className="panel flop-trainer" aria-labelledby="flop-sizing-question">
    <div className="flop-trainer-top">
      <div className="flop-trainer-board" role="group" aria-label="Flop" aria-live="polite">
        {board.cards.map(card => <PlayingCard key={card} card={card} />)}
      </div>
      <div className="flop-trainer-session">
        {modeButtons}
        <span className="flop-trainer-score">{quiz.correct} / {quiz.index + Number(answered)} correct</span>
      </div>
    </div>
    <h2 id="flop-sizing-question" className={roll === null ? undefined : 'flop-trainer-roll-question'} tabIndex={-1} ref={heading}>
      {roll === null ? `Which ${sizing} does the solver use most across the range?` : <>
        <span>Which action fits?</span>
        <span className="flop-trainer-roll-value"><span className="sr-only">Roll </span>{roll}</span>
      </>}
    </h2>
    {roll !== null && <p className="flop-trainer-roll-hint">Use the action order shown, starting at 0.</p>}
    <div className="flop-trainer-choices" role="group" aria-labelledby="flop-sizing-question">
      {options.map(index => <button type="button" className="button flop-trainer-choice" key={actions[index].label}
        aria-pressed={selected === index} aria-disabled={answered} tabIndex={answered && selected !== index ? -1 : undefined}
        data-result={answered && best.includes(index) ? 'correct' : selected === index ? 'incorrect' : undefined}
        onClick={() => answer(index)}>{sizingLabel(actions[index].label)}</button>)}
    </div>
    <div className="flop-trainer-outcome">
      <p className="flop-trainer-result" role="status" data-result={answered ? isCorrect ? 'correct' : 'incorrect' : undefined}>
        {answered && <><strong>{isCorrect ? 'Correct' : 'Incorrect'}</strong>{' · '}{feedback}</>}
      </p>
      {answered && <button type="button" className="button primary flop-trainer-next" onClick={advance}>
        {atEnd ? 'Start again' : 'Next flop'}
      </button>}
    </div>
    {answered && <div className="flop-trainer-feedback">
      <div className="flop-trainer-gradient" style={{ background: gradient }} aria-hidden="true">
        {roll !== null && <span className="flop-trainer-roll-marker" style={{ left: `${roll}%` }} />}
      </div>
      <h3>Full action mix</h3>
      <ul className="flop-board-actions" aria-label="Full action mix">
        {actions.map((action, index) => <li key={action.label}>
          <FlopActionLabel action={{ ...action, label: sizingLabel(action.label) }} />
          <span>{percent.format(board.frequencies[index])}</span>
        </li>)}
      </ul>
    </div>}
  </section>
}
