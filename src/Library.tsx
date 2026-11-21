import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Trash2 } from 'lucide-react'
import { calculationLibrary, handLibrary, supabase, type SavedCalculation, type SavedHand } from './library.ts'

type Entry = { id: string; title: string }

function SavedItems<Row extends Entry>({ title, empty, collection, open }: {
  title: string; empty: string; collection: { list: () => Promise<Row[]>; remove: (id: string) => Promise<void> }; open: (row: Row) => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [problem, setProblem] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let current = true
    collection.list().then(items => {
      if (current) setRows(items)
    }).catch(error => {
      if (current) setProblem(error.message)
    })
    return () => { current = false }
  }, [collection])

  async function remove(id: string) {
    setDeleting(true)
    setProblem('')
    try {
      await collection.remove(id)
      setRows(items => items?.filter(row => row.id !== id) ?? [])
      setConfirm(null)
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  return <section className="panel review-panel">
    <h2>{title}</h2>
    {problem && <p className="error" role="alert">{problem}</p>}
    {!problem && !rows && <p role="status">Loading…</p>}
    {rows?.length === 0 && <p>{empty}</p>}
    {!!rows?.length && <ul className="saved-list">{rows.map(row => <li key={row.id}>
      <button className="button saved-entry" disabled={deleting} onClick={() => open(row)}>{row.title}</button>
      {confirm === row.id ? <div className="delete-actions">
        <button className="button small danger" disabled={deleting} onClick={() => void remove(row.id)}>Delete</button>
        <button className="button small" disabled={deleting} onClick={() => setConfirm(null)}>Cancel</button>
      </div> : <button className="icon-button" aria-label={'Delete ' + row.title} disabled={deleting} onClick={() => setConfirm(row.id)}><Trash2 size={16} /></button>}
    </li>)}</ul>}
  </section>
}

export function Library({ session, openHand, openCalculation, removeHand, removeCalculation }: {
  session: Session; openHand: (hand: SavedHand) => void; openCalculation: (calculation: SavedCalculation) => void
  removeHand: (id: string) => Promise<void>; removeCalculation: (id: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  async function signOut() {
    if (!supabase || busy) return
    setBusy(true)
    setProblem('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="library-workspace">
    <div className="tool-heading"><h1>Library</h1><button className="button small" disabled={busy} onClick={() => void signOut()}>Sign out</button></div>
    {problem && <p className="error" role="alert">{problem}</p>}
    <LibraryItems userId={session.user.id} openHand={openHand} openCalculation={openCalculation} removeHand={removeHand} removeCalculation={removeCalculation} />
  </div>
}

function LibraryItems({ userId, openHand, openCalculation, removeHand, removeCalculation }: {
  userId: string; openHand: (hand: SavedHand) => void; openCalculation: (calculation: SavedCalculation) => void
  removeHand: (id: string) => Promise<void>; removeCalculation: (id: string) => Promise<void>
}) {
  const [hands] = useState(() => ({ list: handLibrary(userId).list, remove: removeHand }))
  const [calculations] = useState(() => ({ list: calculationLibrary(userId).list, remove: removeCalculation }))
  return <div className="library-sections">
    <SavedItems title="Saved hands" empty="No saved hands yet." collection={hands} open={openHand} />
    <SavedItems title="Saved calculations" empty="No saved calculations yet." collection={calculations} open={openCalculation} />
  </div>
}
