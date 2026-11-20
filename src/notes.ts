import { supabase } from './library.ts'

export type NoteSummary = { id: string; title: string; updated_at: string }
export type SavedNote = NoteSummary & { body: string }
type NoteText = Pick<SavedNote, 'title' | 'body'>

const summaryColumns = 'id,title,updated_at'
const noteColumns = summaryColumns + ',body'

export class NoteChangedError extends Error {}

export function privateNotes(userId: string) {
  const table = () => {
    if (!supabase) throw new Error('Supabase is required to use Notes.')
    return supabase.from('saved_notes')
  }

  async function read(id: string) {
    const { data, error } = await table().select(noteColumns).eq('owner_id', userId).eq('id', id)
      .maybeSingle().overrideTypes<SavedNote, { merge: false }>()
    if (error) throw error
    return data
  }

  return {
    async list(signal: AbortSignal) {
      const notes = new Map<string, NoteSummary>()
      const pageSize = 500
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await table().select(summaryColumns).eq('owner_id', userId)
          .order('updated_at', { ascending: false }).order('id', { ascending: false })
          .range(offset, offset + pageSize - 1).abortSignal(signal).overrideTypes<NoteSummary[], { merge: false }>()
        if (error) throw error
        for (const note of data) notes.set(note.id, note)
        if (data.length < pageSize) return [...notes.values()]
      }
    },
    read,
    async save(id: string, text: NoteText, revision: string | null) {
      const request = revision
        ? table().update(text).eq('owner_id', userId).eq('id', id).eq('updated_at', revision)
        : table().upsert({ id, owner_id: userId, ...text }, { onConflict: 'id', ignoreDuplicates: true })
      const { data, error } = await request.select(noteColumns).maybeSingle().overrideTypes<SavedNote, { merge: false }>()
      if (error) throw error
      if (data) return data

      // A previous save can have committed even when the browser missed its response.
      const current = await read(id)
      if (current?.title === text.title && current.body === text.body) return current
      throw new NoteChangedError('The saved note changed. Save a copy to keep your edits.')
    },
    async remove(note: SavedNote) {
      const { data, error } = await table().delete().eq('owner_id', userId).eq('id', note.id)
        .eq('updated_at', note.updated_at).select('id').maybeSingle()
      if (error) throw error
      if (!data && await read(note.id)) throw new NoteChangedError('The saved note changed. Reopen it before deleting.')
    },
  }
}
