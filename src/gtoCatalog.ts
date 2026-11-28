import { supabase } from './library.ts'
import { type GtoNode, type GtoStudy } from './gtoPreflop.ts'

export async function studyFingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export type GtoFlopReference = {
  format_version: number
  strategy_path: string
  strategy_sha256: string
  action_ev_path: string | null
  action_ev_sha256: string | null
}

export async function findGtoFlop(study: GtoStudy, node: GtoNode, signal: AbortSignal): Promise<GtoFlopReference | null> {
  if (!supabase) throw new Error('The strategy catalog is unavailable.')
  if (!node.parentId || node.game.board.length !== 3) return null
  const source = study.source
  const { data: version, error: versionError } = await supabase.from('gto_strategy_versions').select('revision')
    .eq('library_key', study.libraryKey).eq('study_path', source.studyPath).eq('combo_order', source.comboOrder)
    .eq('preset_name', source.preset).eq('source_sha256', source.fingerprint).eq('adapter_version', source.adapterVersion)
    .order('revision', { ascending: false }).limit(1).abortSignal(signal).maybeSingle()
  if (versionError) throw versionError
  if (!version) return null

  const [card0, card1, card2] = [...node.game.board].sort((a, b) => a - b)
  const { data, error } = await supabase.from('gto_flop_solutions')
    .select('format_version,strategy_path,strategy_sha256,action_ev_path,action_ev_sha256')
    .eq('library_key', study.libraryKey).eq('revision', version.revision).eq('matchup_key', node.parentId)
    .eq('card0', card0).eq('card1', card1).eq('card2', card2).abortSignal(signal).maybeSingle()
  if (error) throw error
  return data
}
