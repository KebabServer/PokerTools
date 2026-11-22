import assert from 'node:assert/strict'
import test from 'node:test'
import { createNoteStore, NoteChangedError } from '../src/noteAutosave.ts'

const original = { id: 'first', title: 'Existing note', body: 'Original', pinned: false, updated_at: '2026-11-20T12:00:00Z' }

test('debounced writes serialize and use the latest acknowledged revision', async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const starts = []
  const store = createNoteStore({
    list: async () => [original],
    save: (id, text, revision) => new Promise(resolve => starts.push({ text, revision, resolve })),
  })
  await store.refresh()
  store.edit(original.id, { body: 'First write' })
  mock.timers.tick(649)
  assert.equal(starts.length, 0)
  mock.timers.tick(1)
  assert.equal(starts.length, 1)
  assert.equal(starts[0].revision, original.updated_at)

  store.edit(original.id, { body: 'Intermediate draft' })
  store.edit(original.id, { body: 'Latest draft', pinned: true })
  mock.timers.tick(650)
  assert.equal(starts.length, 1)
  const firstSave = { ...original, ...starts[0].text, updated_at: '2026-11-20T12:00:01Z' }
  starts[0].resolve(firstSave)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(starts.length, 2)
  assert.equal(starts[1].revision, firstSave.updated_at)
  assert.equal(store.getSnapshot()[0].note.body, 'Latest draft')
  assert.equal(store.getSnapshot()[0].note.pinned, true)

  const secondSave = { ...original, ...starts[1].text, updated_at: '2026-11-20T12:00:02Z' }
  starts[1].resolve(secondSave)
  await store.flush()
  assert.deepEqual(store.getSnapshot()[0].note, secondSave)
  assert.equal(store.getSnapshot()[0].dirty, false)
})

test('refresh keeps a draft when the saved revision changed or was deleted', async () => {
  for (const remote of [[], [{ ...original, body: 'Remote edit', updated_at: '2026-11-20T12:00:01Z' }]]) {
    let notes = [original]
    const saved = []
    const store = createNoteStore({
      list: async () => notes,
      read: async () => remote[0] ?? null,
      save: async (id, text, revision) => {
        assert.equal(revision, null)
        const copy = { id, ...text, updated_at: '2026-11-20T12:00:02Z' }
        saved.push(copy)
        return copy
      },
    })
    await store.refresh()
    store.edit(original.id, { body: 'Draft to recover' })
    notes = remote
    await store.refresh()
    const [entry] = store.getSnapshot()
    assert.equal(entry.note.body, 'Draft to recover')
    assert.ok(entry.problem instanceof NoteChangedError)
    assert.equal(entry.dirty, true)

    const copy = await store.copy(original.id)
    assert.deepEqual(saved, [copy])
    assert.equal(copy.title, 'Existing note (copy)')
    assert.equal(copy.body, 'Draft to recover')
    assert.deepEqual(store.getSnapshot().map(item => item.note), [...remote, copy])
    await store.flush()
  }
})

test('creating a linked note keeps parent edits made during creation and flushes both', async () => {
  const writes = []
  const { promise, resolve } = Promise.withResolvers()
  const store = createNoteStore({
    list: async () => [original],
    save: async (id, text, revision) => {
      writes.push({ id, text, revision })
      if (revision === null) await promise
      return { id, ...text, updated_at: '2026-11-20T12:00:01Z' }
    },
  })
  await store.refresh()
  const creation = store.create('Big blind notes', { id: original.id, body: original.body, range: { start: 0, end: 8 } })
  store.edit(original.id, { body: 'Edits made while waiting' })
  const flush = store.flush()
  resolve()
  const child = await creation
  await flush

  assert.equal(writes.length, 2)
  assert.deepEqual(writes[0], { id: child.id, text: { title: 'Big blind notes', body: '', pinned: false }, revision: null })
  assert.equal(writes[1].revision, original.updated_at)
  assert.equal(writes[1].text.body, 'Edits made while waiting\n\n[Big blind notes](#notes/' + child.id + ')')
})
