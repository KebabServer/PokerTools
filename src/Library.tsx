import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { calculationLibrary, handLibrary, type SavedCalculation, type SavedHand } from './library.ts'
import { prepareBackup } from './backup.ts'

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

function Backup({ userId, flushNotes, signingOut }: {
  userId: string; flushNotes: () => Promise<void> | undefined; signingOut: boolean
}) {
  const request = useRef<AbortController | null>(null)
  const objectUrl = useRef<string | null>(null)
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null)
  const [progress, setProgress] = useState('')
  const [problem, setProblem] = useState('')

  useEffect(() => () => {
    request.current?.abort()
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
  }, [])

  async function prepare() {
    if (request.current || signingOut) return
    const controller = new AbortController()
    request.current = controller
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
    setDownload(null)
    setProblem('')
    setProgress('Preparing backup…')

    try {
      await flushNotes()?.catch(() => {
        throw new Error('A note couldn’t be saved. Finish saving it in Notes and try again.')
      })
      const { file, filename } = await prepareBackup(userId, controller.signal, setProgress)
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(file)
      objectUrl.current = url
      setDownload({ url, filename })
    } catch (error) {
      if (!controller.signal.aborted) setProblem(error instanceof Error ? error.message : 'Couldn’t prepare the backup.')
    } finally {
      request.current = null
      if (!controller.signal.aborted) setProgress('')
    }
  }

  return <section className="panel review-panel">
    <h2>Backup</h2>
    <p>Save a JSON copy of your hands, equity calculations, notes, and imported flops. Solver solutions are included from this browser.</p>
    <div className="backup-actions">
      {download && !signingOut && <a className="button primary" href={download.url} download={download.filename}>Download backup</a>}
      <button className={'button' + (download ? '' : ' primary')} disabled={!!progress || signingOut} onClick={() => void prepare()}>
        {download ? 'Prepare a new backup' : 'Prepare backup'}
      </button>
    </div>
    {progress && <p role="status">{progress}</p>}
    {download && <p role="status">Backup ready.</p>}
    {problem && <p role="alert" className="error">{problem}</p>}
  </section>
}

export function Library({ userId, openHand, openCalculation, removeHand, removeCalculation, signingOut, flushNotes }: {
  userId: string; openHand: (hand: SavedHand) => void; openCalculation: (calculation: SavedCalculation) => void
  removeHand: (id: string) => Promise<void>; removeCalculation: (id: string) => Promise<void>
  signingOut: boolean; flushNotes: () => Promise<void> | undefined
}) {
  return <div className="library-workspace">
    <div className="tool-heading"><h1>Library</h1></div>
    <div className="library-sections">
      <Backup userId={userId} flushNotes={flushNotes} signingOut={signingOut} />
      <LibraryItems userId={userId} openHand={openHand} openCalculation={openCalculation} removeHand={removeHand} removeCalculation={removeCalculation} />
    </div>
  </div>
}

function LibraryItems({ userId, openHand, openCalculation, removeHand, removeCalculation }: {
  userId: string; openHand: (hand: SavedHand) => void; openCalculation: (calculation: SavedCalculation) => void
  removeHand: (id: string) => Promise<void>; removeCalculation: (id: string) => Promise<void>
}) {
  const [hands] = useState(() => ({ list: handLibrary(userId).list, remove: removeHand }))
  const [calculations] = useState(() => ({ list: calculationLibrary(userId).list, remove: removeCalculation }))
  return <>
    <SavedItems title="Saved hands" empty="No saved hands yet." collection={hands} open={openHand} />
    <SavedItems title="Saved calculations" empty="No saved calculations yet." collection={calculations} open={openCalculation} />
  </>
}
