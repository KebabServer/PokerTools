import { useMemo, useRef, useState } from 'react'
import { FlopActionLabel } from './FlopReportChart.tsx'
import { PlayingCard } from './PlayingCard.tsx'
import type { FlopReport } from './flopReport.ts'
import { flopSizingQuestions, type FlopSizingQuestion } from './flopSizingTrainer.ts'

const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 3 })
const list = new Intl.ListFormat('en')
const sizingLabel = (label: string) => label === 'AI' ? 'All-in' : label

type Quiz = {
  deck: FlopSizingQuestion[]
  index: number
  answer: number | null
  correct: number
}

function startQuiz(questions: FlopSizingQuestion[]): Quiz {
  const deck = questions.slice()
  for (let index = deck.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    const question = deck[index]
    deck[index] = deck[other]
    deck[other] = question
  }
  return { deck, index: 0, answer: null, correct: 0 }
}

export function FlopSizingTrainer({ report }: { report: FlopReport }) {
  const { actions } = report
  const { choices, questions } = useMemo(() => flopSizingQuestions(report), [report])
  const [quiz, setQuiz] = useState(() => startQuiz(questions))
  const heading = useRef<HTMLHeadingElement>(null)
  const question = quiz.deck[quiz.index]
  if (!question) return <p className="flop-report-status" role="status">This report has no sizing questions. Choose another spot to start.</p>

  const { board, best } = question
  const selected = quiz.answer
  const answered = selected !== null
  const isCorrect = answered && best.includes(selected)
  const atEnd = quiz.index === quiz.deck.length - 1
  const hasBets = actions.some(action => action.label.startsWith('B'))
  const hasRaises = actions.some(action => action.label.startsWith('R'))
  const sizing = hasBets === hasRaises ? 'sizing' : hasBets ? 'bet size' : 'raise size'
  const bestLabels = list.format(best.map(index => sizingLabel(actions[index].label)))

  function answer(index: number) {
    setQuiz(current => {
      if (current.answer !== null) return current
      return { ...current, answer: index, correct: current.correct + Number(best.includes(index)) }
    })
  }

  function advance() {
    setQuiz(atEnd ? startQuiz(questions) : { ...quiz, index: quiz.index + 1, answer: null })
    heading.current?.focus()
  }

  return <section className="panel flop-trainer" aria-labelledby="flop-sizing-question">
    <div className="flop-trainer-top">
      <div className="flop-trainer-board" role="group" aria-label="Flop" aria-live="polite">
        {board.cards.map(card => <PlayingCard key={card} card={card} />)}
      </div>
      <span className="flop-trainer-score">{quiz.correct} / {quiz.index + Number(answered)} correct</span>
    </div>
    <h2 id="flop-sizing-question" tabIndex={-1} ref={heading}>Which {sizing} does the solver use most across the range?</h2>
    <div className="flop-trainer-choices" role="group" aria-labelledby="flop-sizing-question">
      {choices.map(index => <button type="button" className="button flop-trainer-choice" key={actions[index].label}
        aria-pressed={selected === index} aria-disabled={answered} tabIndex={answered && selected !== index ? -1 : undefined}
        data-result={answered && best.includes(index) ? 'correct' : selected === index ? 'incorrect' : undefined}
        onClick={() => answer(index)}>{sizingLabel(actions[index].label)}</button>)}
    </div>
    <div className="flop-trainer-outcome">
      <p className="flop-trainer-result" role="status" data-result={answered ? isCorrect ? 'correct' : 'incorrect' : undefined}>
        {answered && <><strong>{isCorrect ? 'Correct' : 'Incorrect'}</strong>{' · '}{bestLabels}{best.length > 1 ? ' tie at ' : ' is used most at '}
          {percent.format(board.frequencies[best[0]])}.</>}
      </p>
      {answered && <button type="button" className="button primary flop-trainer-next" onClick={advance}>
        {atEnd ? 'Start again' : 'Next flop'}
      </button>}
    </div>
    {answered && <div className="flop-trainer-feedback">
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
