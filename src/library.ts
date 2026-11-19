import { createClient } from '@supabase/supabase-js'
import type { Hand } from './replay.ts'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const supabase = url && key?.startsWith('sb_publishable_') ? createClient(url, key) : null

export type SavedHand = {
  id: string
  title: string
  notes: string
  hand_data: Hand
  created_at: string
  updated_at: string
}

type HandWrite = Partial<Pick<SavedHand, 'title' | 'notes' | 'hand_data'>>

export function handLibrary(userId: string) {
  const table = () => {
    if (!supabase) throw new Error('The saved library has not been configured.')
    return supabase.from('saved_hands')
  }
  return {
    async list() {
      const { data, error } = await table().select('id,title,notes,hand_data,created_at,updated_at')
        .eq('owner_id', userId).order('updated_at', { ascending: false })
      if (error) throw error
      return data as SavedHand[]
    },
    async save(values: HandWrite, id: string | null) {
      const request = id
        ? table().update(values).eq('owner_id', userId).eq('id', id)
        : table().insert({ ...values, owner_id: userId })
      const { data, error } = await request.select('id,title,notes,hand_data,created_at,updated_at').single()
      if (error) throw error
      return data as SavedHand
    },
    async remove(id: string) {
      const { error } = await table().delete().eq('owner_id', userId).eq('id', id).select('id').single()
      if (error) throw error
    },
  }
}
