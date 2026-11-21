export type SavedSolution = { id: string; label: string; data: object }

export function createSolverStorage(userId: string) {
  let connection: Promise<IDBDatabase> | undefined

  function open() {
    connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('PokerTools-turn-river-lab:' + userId, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('solutions', { keyPath: 'id' })
        request.result.createObjectStore('catalog', { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }).catch(error => {
      connection = undefined
      throw error
    })
    return connection
  }

  async function transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    operation: (tx: IDBTransaction) => IDBRequest<T> | void,
  ): Promise<T | undefined> {
    const db = await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      const request = operation(tx)
      tx.oncomplete = () => resolve(request?.result)
      tx.onabort = () => reject(tx.error ?? new Error('Solution storage transaction was aborted.'))
    })
  }

  return {
    list: () => transaction<Pick<SavedSolution, 'id' | 'label'>[]>(['catalog'], 'readonly', tx =>
      tx.objectStore('catalog').getAll()),
    load: (id: string) => transaction<SavedSolution>(['solutions'], 'readonly', tx =>
      tx.objectStore('solutions').get(id)),
    save: (row: SavedSolution) => transaction(['solutions', 'catalog'], 'readwrite', tx => {
      tx.objectStore('solutions').put(row)
      tx.objectStore('catalog').put({ id: row.id, label: row.label })
    }),
    remove: (id: string) => transaction(['solutions', 'catalog'], 'readwrite', tx => {
      tx.objectStore('solutions').delete(id)
      tx.objectStore('catalog').delete(id)
    }),
  }
}
