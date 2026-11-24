import { supabase } from './library.ts'
import { NoteChangedError } from './noteAutosave.ts'
import { sameNoteText, type NotePages } from './notePages.ts'

export type SavedNote = { id: string; title: string; body: string; pinned: boolean; pages: NotePages; updated_at: string }
export type NoteText = Pick<SavedNote, 'title' | 'body' | 'pinned' | 'pages'>

const noteColumns = 'id,title,body,pinned,pages,updated_at'

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
    async list(signal?: AbortSignal) {
      const notes: SavedNote[] = []
      const pageSize = 500
      for (;;) {
        let request = table().select(noteColumns).eq('owner_id', userId).order('id').limit(pageSize)
        const last = notes.at(-1)
        if (last) request = request.gt('id', last.id)
        if (signal) request = request.abortSignal(signal)
        const { data, error } = await request.overrideTypes<SavedNote[], { merge: false }>()
        if (error) throw error
        notes.push(...data)
        if (data.length < pageSize) return notes
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
      if (current && sameNoteText(current, text)) return current
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
