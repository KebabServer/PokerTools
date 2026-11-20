import { createClient } from '@supabase/supabase-js'
import type { EquityInput, EquityResult } from './equity.ts'
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

export type SavedCalculation = {
  id: string
  title: string
  input: EquityInput
  result: EquityResult
  created_at: string
}

type HandWrite = Partial<Pick<SavedHand, 'title' | 'notes' | 'hand_data'>>
type CalculationWrite = Pick<SavedCalculation, 'title' | 'input' | 'result'>

function privateCollection<Row, Write extends object>(name: string, columns: string, order: string, userId: string) {
  const table = () => {
    if (!supabase) throw new Error('The saved library has not been configured.')
    return supabase.from(name)
  }
  return {
    async list() {
      const { data, error } = await table().select(columns).eq('owner_id', userId).order(order, { ascending: false }).overrideTypes<Row[], { merge: false }>()
      if (error) throw error
      return data
    },
    async save(values: Write, id?: string | null) {
      const request = id
        ? table().update(values).eq('owner_id', userId).eq('id', id)
        : table().insert({ ...values, owner_id: userId })
      const { data, error } = await request.select(columns).single().overrideTypes<Row, { merge: false }>()
      if (error) throw error
      return data
    },
    async remove(id: string) {
      const { error } = await table().delete().eq('owner_id', userId).eq('id', id).select('id').single()
      if (error) throw error
    },
  }
}

export const handLibrary = (userId: string) => privateCollection<SavedHand, HandWrite>(
  'saved_hands', 'id,title,notes,hand_data,created_at,updated_at', 'updated_at', userId,
)

export const calculationLibrary = (userId: string) => privateCollection<SavedCalculation, CalculationWrite>(
  'saved_calculations', 'id,title,input,result,created_at', 'created_at', userId,
)
