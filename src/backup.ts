import { supabase } from './library.ts'
import { createSolverStorage } from './turnRiverLab/storage.ts'

const cloudCollections = [
  { key: 'hands', table: 'saved_hands', columns: 'id,title,notes,hand_data,created_at,updated_at', limit: 100, label: 'saved hands' },
  { key: 'calculations', table: 'saved_calculations', columns: 'id,title,input,result,created_at', limit: 100, label: 'saved equity calculations' },
  { key: 'notes', table: 'saved_notes', columns: 'id,title,body,pinned,pages,updated_at', limit: 100, label: 'notes' },
  { key: 'flopViewerSpots', table: 'flop_viewer_spots', columns: 'id,configuration,board,nodes', limit: 10, label: 'saved Flop Viewer spots' },
] as const

export async function prepareBackup(userId: string, signal: AbortSignal, onProgress: (status: string) => void) {
  const client = supabase
  if (!client) throw new Error('The saved library has not been configured.')

  const exportedAt = new Date().toISOString()
  const header = JSON.stringify({ format: 'PokerTools-backup', version: 1, exportedAt, data: {} }).slice(0, -2)
  const parts: BlobPart[] = []

  function checkAbort() {
    if (signal.aborted) throw new DOMException('Backup cancelled.', 'AbortError')
  }

  async function addCollection(key: string, label: string, readPage: (after?: string) => Promise<{ id: string }[]>) {
    checkAbort()
    onProgress(`Reading ${label}…`)
    if (parts.length) parts.push(',')
    parts.push(JSON.stringify(key), ':[')
    let after: string | undefined
    for (;;) {
      const rows = await readPage(after)
      checkAbort()
      if (!rows.length) break
      const last = rows.at(-1)!.id
      if (typeof last !== 'string' || (after !== undefined && last <= after)) throw new Error(`Couldn’t finish reading ${label}.`)
      if (after !== undefined) parts.push(',')
      // Encode each batch separately so large flop libraries never need one giant JSON string.
      parts.push(new Blob(rows.flatMap((row, index) => index ? [',', JSON.stringify(row)] : [JSON.stringify(row)])))
      after = last
    }
    parts.push(']')
  }

  for (const { key, table, columns, limit, label } of cloudCollections) {
    await addCollection(key, label, async after => {
      let request = client.from(table).select(columns).eq('owner_id', userId).order('id').limit(limit).abortSignal(signal)
      if (after !== undefined) request = request.gt('id', after)
      const { data, error } = await request.overrideTypes<{ id: string }[], { merge: false }>()
      if (error) throw new Error(`Couldn’t read ${label}.`)
      return data
    })
  }

  const solver = createSolverStorage(userId)
  try {
    await addCollection('solverSolutions', 'Solver solutions saved in this browser', async after => {
      try {
        return (await solver.readSavedPage(after)) ?? []
      } catch {
        throw new Error('Couldn’t read Solver solutions from this browser.')
      }
    })
  } finally {
    await solver.close()
  }

  return {
    file: new Blob([header, ...parts, '}}\n'], { type: 'application/json' }),
    filename: `PokerTools-backup-${exportedAt.slice(0, 19).replaceAll(':', '-')}Z.json`,
  }
}
