import { useEffect, useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { actionTypes, streets, type Action, type ActionType, type Hand, type Player, type Replay } from './replay.ts'

const labels: Record<ActionType, string> = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise to', 'all-in': 'All-in' }
const hasAmount = (type: ActionType) => type === 'bet' || type === 'raise'

function Amount({ label, value, onChange }: { label: string; value: number | undefined; onChange: (value: number) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const parse = (input: string) => /^\d*(?:[.,]\d{0,2})?$/.test(input) ? Number(input.replace(',', '.')) : NaN
  useEffect(() => {
    setText(previous => value !== undefined && Object.is(parse(previous), value) ? previous : value === undefined ? '' : String(value))
  }, [value])
  return <label>{label}<input inputMode="decimal" value={text} onChange={event => {
    setText(event.target.value)
    onChange(parse(event.target.value))
  }} /></label>
}

function ActionTypeSelect({ value, onChange }: { value: ActionType; onChange: (type: ActionType) => void }) {
  return <label>Action<select value={value} onChange={event => onChange(event.target.value as ActionType)}>
    {actionTypes.map(type => <option value={type} key={type}>{labels[type]}</option>)}
  </select></label>
}

export function HandEditor({ hand, title, result, setHand, setTitle }: {
  hand: Hand; title: string; result: Replay; setHand: (hand: Hand) => void; setTitle: (title: string) => void
}) {
  const [type, setType] = useState<ActionType>('fold')
  const [amount, setAmount] = useState<number>()
  const [edit, setEdit] = useState<number | null>(null)
  const next = result.next
  const patch = (values: Partial<Hand>) => setHand({ ...hand, ...values })

  function updatePlayer(index: number, values: Partial<Player>) {
    const previous = hand.players[index].seat
    const seat = values.seat ?? previous
    patch({
      players: hand.players.map((player, position) => position === index ? { ...player, ...values } : player),
      button: hand.button === previous ? seat : hand.button,
      actions: hand.actions.map(action => action.seat === previous ? { ...action, seat } : action),
    })
  }

  function addPlayer() {
    const seat = Array.from({ length: 10 }, (_, index) => index + 1).find(number => !hand.players.some(player => player.seat === number))
    if (seat) patch({ players: [...hand.players, { seat, name: 'Player ' + seat, stack: 100, cards: '' }] })
  }

  function removePlayer(index: number) {
    const seat = hand.players[index].seat
    const players = hand.players.filter((_, position) => position !== index)
    patch({ players, button: hand.button === seat ? players[0].seat : hand.button, actions: hand.actions.filter(action => action.seat !== seat) })
  }

  function changeAction(index: number, values: Partial<Action>) {
    patch({ actions: hand.actions.map((action, position) => position === index ? { ...action, ...values } : action) })
  }

  return <div className="editor">
    <p>Set the table, enter known cards, then record actions in order.</p>
    <div className="editor-section">
      <h3>Table setup</h3>
      <div className="form-grid setup-grid">
        <label>Hand title<input value={title} maxLength={120} onChange={event => setTitle(event.target.value)} /></label>
        <label>Dealer button<select value={hand.button} onChange={event => patch({ button: Number(event.target.value) })}>{hand.players.map((player, index) => <option key={index} value={player.seat}>{player.seat} · {player.name}</option>)}</select></label>
        <Amount label="Small blind" value={hand.smallBlind} onChange={smallBlind => patch({ smallBlind })} />
        <Amount label="Big blind" value={hand.bigBlind} onChange={bigBlind => patch({ bigBlind })} />
        <Amount label="Ante per seat" value={hand.ante} onChange={ante => patch({ ante })} />
      </div>
    </div>
    <div className="editor-section">
      <div className="section-head"><h3>Players</h3><button className="button small" onClick={addPlayer} disabled={hand.players.length >= 10}><Plus size={15} /> Add player</button></div>
      {hand.players.map((player, index) => <div className="player-fields" key={index}>
        <label>Seat<select value={player.seat} aria-label={'Seat for ' + player.name} onChange={event => updatePlayer(index, { seat: Number(event.target.value) })}>
          {Array.from({ length: 10 }, (_, i) => i + 1).filter(seat => seat === player.seat || !hand.players.some(other => other.seat === seat)).map(seat => <option key={seat}>{seat}</option>)}
        </select></label>
        <label>Name<input value={player.name} onChange={event => updatePlayer(index, { name: event.target.value })} maxLength={40} /></label>
        <Amount label="Starting stack" value={player.stack} onChange={stack => updatePlayer(index, { stack })} />
        <label>Known hole cards<input value={player.cards} onChange={event => updatePlayer(index, { cards: event.target.value })} placeholder="As Kd" autoComplete="off" spellCheck={false} /></label>
        <button className="icon-button" disabled={hand.players.length <= 2} aria-label={'Remove ' + player.name} onClick={() => removePlayer(index)}><Trash2 size={16} /></button>
      </div>)}
      <p className="field-hint">Leave unknown cards blank.</p>
    </div>
    <div className="editor-section">
      <h3>Community cards</h3>
      <div className="form-grid community-grid">
        {streets.slice(1).map((street, index) => <label key={street}>{street}<input value={hand.board[index]} placeholder={['As 9h 4c', '8h', '2d'][index]} autoComplete="off" spellCheck={false} onChange={event => {
          const board = [...hand.board] as Hand['board']
          board[index] = event.target.value
          patch({ board })
        }} /></label>)}
      </div>
    </div>
    <div className="editor-section">
      <h3>Actions</h3>
      {hand.actions.length > 0 && <ol className="editable-actions">
        {hand.actions.map((action, index) => <li key={index}>
          <div className="action-edit-heading">
            <button className="button text-button" aria-expanded={edit === index} onClick={() => setEdit(edit === index ? null : index)}>
              <ChevronDown size={15} />{streets[action.street]} · {hand.players.find(player => player.seat === action.seat)?.name} · {labels[action.type]}{hasAmount(action.type) ? ' ' + (action.amount ?? 0) : ''}
            </button>
            <button className="icon-button" aria-label={'Remove action ' + (index + 1)} onClick={() => { patch({ actions: hand.actions.filter((_, position) => position !== index) }); setEdit(null) }}><Trash2 size={15} /></button>
          </div>
          {edit === index && <div className="form-grid action-fields">
            <label>Street<select value={action.street} onChange={event => changeAction(index, { street: Number(event.target.value) })}>{streets.map((street, value) => <option key={street} value={value}>{street}</option>)}</select></label>
            <label>Player<select value={action.seat} onChange={event => changeAction(index, { seat: Number(event.target.value) })}>{hand.players.map(player => <option value={player.seat} key={player.seat}>{player.name}</option>)}</select></label>
            <ActionTypeSelect value={action.type} onChange={type => changeAction(index, { type, amount: undefined })} />
            {hasAmount(action.type) && <Amount label={labels[action.type] + ' amount'} value={action.amount} onChange={amount => changeAction(index, { amount })} />}
          </div>}
        </li>)}
      </ol>}
      {next && <form className="action-composer" onSubmit={event => {
        event.preventDefault()
        patch({ actions: [...hand.actions, { ...next, type, amount: hasAmount(type) ? amount : undefined }] })
        setAmount(undefined)
      }}>
        <p><strong>{hand.players.find(player => player.seat === next.seat)?.name}</strong> acts next on the {streets[next.street].toLowerCase()}.</p>
        <div className="form-grid action-fields">
          <ActionTypeSelect value={type} onChange={setType} />
          {hasAmount(type) && <Amount label={labels[type] + ' amount'} value={amount} onChange={setAmount} />}
          <button type="submit" className="button primary"><Plus size={16} /> Add action</button>
        </div>
      </form>}
      {result.error && <p className="error" role="alert">{result.error}</p>}
      {result.missingBoard && <p className="field-hint">Enter the {streets[result.missingBoard].toLowerCase()} cards to continue.</p>}
      {result.complete && <p className="success" role="status">Hand is complete and ready to save.</p>}
    </div>
  </div>
}
