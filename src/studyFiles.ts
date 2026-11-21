import { supabase } from './library.ts'

export async function readStudyFile(path: string, signal: AbortSignal) {
  if (!supabase) throw new Error('Supabase is required for study files.')
  const { data, error } = await supabase.from('study_files').select('contents')
    .eq('path', path).abortSignal(signal).single()
  if (error) throw error
  return data.contents as string
}
