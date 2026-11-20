import { supabase } from './library.ts'
import { readFlopSpot } from './flopViewerImport.ts'
import type { FlopSpot } from './flopStrategy.ts'

export type FlopConfiguration = { configuration: string; is_example: boolean }
export type FlopBoardChoice = { id: string; board: string }

function client() {
  if (!supabase) throw new Error('Supabase is required for Flop Viewer.')
  return supabase
}

export async function listFlopConfigurations(signal: AbortSignal): Promise<FlopConfiguration[]> {
  const { data, error } = await client().rpc('flop_viewer_configurations').abortSignal(signal)
  if (error) throw error
  if (!Array.isArray(data) || data.some(row => typeof row?.configuration !== 'string' || typeof row?.is_example !== 'boolean')) {
    throw new Error('Invalid flop configurations.')
  }
  return data
}

export async function listFlopBoards(configuration: FlopConfiguration, signal: AbortSignal) {
  const boards: FlopBoardChoice[] = []
  const pageSize = 500
  for (;;) {
    let request = client().from('flop_viewer_spots').select('id,board')
      .eq('configuration', configuration.configuration).eq('is_example', configuration.is_example)
      .order('board').limit(pageSize).abortSignal(signal)
    const last = boards.at(-1)
    if (last) request = request.gt('board', last.board)
    const { data, error } = await request.overrideTypes<FlopBoardChoice[], { merge: false }>()
    if (error) throw error
    boards.push(...data)
    if (data.length < pageSize) return boards
  }
}

export async function getFlopSpot(id: string, signal: AbortSignal) {
  const { data, error } = await client().from('flop_viewer_spots').select('configuration,board,nodes')
    .eq('id', id).abortSignal(signal).single()
  if (error) throw error
  return readFlopSpot(data)
}

export async function saveFlopSpots(spots: FlopSpot[], userId: string) {
  const table = client().from('flop_viewer_spots')
  const encoder = new TextEncoder()
  const batch: (FlopSpot & { owner_id: string })[] = []
  let bytes = 0
  let saved = 0
  async function saveBatch() {
    const { error } = await table.upsert(batch, { onConflict: 'owner_id,configuration,board' })
    if (error) {
      const detail = saved ? `Saved ${saved} of ${spots.length} flops. Import the same file to retry. ` : ''
      throw new Error(detail + error.message)
    }
    saved += batch.length
    batch.length = 0
    bytes = 0
  }
  for (const spot of spots) {
    const row = { ...spot, owner_id: userId }
    const size = encoder.encode(JSON.stringify(row)).length + 1
    if (batch.length && bytes + size > 512 * 1024) await saveBatch()
    batch.push(row)
    bytes += size
  }
  if (batch.length) await saveBatch()
}
