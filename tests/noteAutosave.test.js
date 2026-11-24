import assert from 'node:assert/strict'
import test from 'node:test'
import { createNoteStore, NoteChangedError } from '../src/noteAutosave.ts'
import { emptyNotePages, firstPageId, pagesForNote, sameNoteText } from '../src/notePages.ts'

const original = { id: 'first', title: 'Existing note', body: 'Original', pinned: false, pages: emptyNotePages, updated_at: '2026-11-20T12:00:00Z' }

test('debounced writes serialize and use the latest acknowledged revision', async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const starts = []
  const store = createNoteStore({
    list: async () => [original],
    save: (id, text, revision) => new Promise(resolve => starts.push({ text, revision, resolve })),
  })
  await store.refresh()
  store.editPage(original.id, firstPageId, { body: 'First write' })
  mock.timers.tick(649)
  assert.equal(starts.length, 0)
  mock.timers.tick(1)
  assert.equal(starts.length, 1)
  assert.equal(starts[0].revision, original.updated_at)

  store.editPage(original.id, firstPageId, { body: 'Intermediate draft' })
  store.editPage(original.id, firstPageId, { body: 'Latest draft' })
  store.edit(original.id, { pinned: true })
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
    store.editPage(original.id, firstPageId, { body: 'Draft to recover' })
    const pageId = store.addPage(original.id)
    store.editPage(original.id, pageId, { title: 'Review', body: 'Second draft' })
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
    assert.deepEqual(copy.pages.extra, [{ id: pageId, title: 'Review', body: 'Second draft' }])
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
  const pageId = store.addPage(original.id)
  store.editPage(original.id, pageId, { body: 'Review this spot' })
  const creation = store.create('Big blind notes', { id: original.id, pageId, body: 'Review this spot', range: { start: 0, end: 6 } })
  store.editPage(original.id, pageId, { body: 'Edits made while waiting' })
  const flush = store.flush()
  resolve()
  const child = await creation
  await flush

  assert.equal(writes.length, 2)
  assert.deepEqual(writes[0], { id: child.id, text: { title: 'Big blind notes', body: '', pinned: false, pages: emptyNotePages }, revision: null })
  assert.equal(writes[1].revision, original.updated_at)
  assert.equal(writes[1].text.body, original.body)
  assert.equal(writes[1].text.pages.extra[0].body, 'Edits made while waiting\n\n[Big blind notes](#notes/' + child.id + ')')
})

test('undo and redo a sub-note link after autosave and refresh', async () => {
  const saved = new Map([[original.id, original]])
  const store = createNoteStore({
    list: async () => [...saved.values()],
    save: async (id, text) => {
      const note = { id, ...text, updated_at: new Date().toISOString() }
      saved.set(id, note)
      return note
    },
  })
  await store.refresh()
  const range = { start: 0, end: original.body.length }
  const child = await store.create('Sub-note', { id: original.id, pageId: firstPageId, body: original.body, range })
  await store.flush()
  await store.refresh()
  const linkedText = '[Original](#notes/' + child.id + ')'
  assert.equal(saved.get(original.id).body, linkedText)
  assert.equal(store.navigateHistory(child.id, firstPageId, 'undo'), undefined)

  assert.deepEqual(store.navigateHistory(original.id, firstPageId, 'undo'), range)
  await store.flush()
  assert.equal(saved.get(original.id).body, original.body)
  assert.deepEqual(saved.get(child.id), child)
  assert.equal(store.navigateHistory(original.id, firstPageId, 'redo').end, linkedText.length)
  await store.flush()
  assert.equal(saved.get(original.id).body, linkedText)

  saved.set(original.id, { ...original, body: 'Edited in another tab' })
  await store.refresh()
  assert.equal(store.navigateHistory(original.id, firstPageId, 'undo'), undefined)
})

test('pages save together and keep independent undo histories through refresh', async () => {
  let saved = original
  let revision = 0
  const repository = {
    list: async () => [saved],
    save: async (id, text) => {
      saved = { ...structuredClone(text), id, updated_at: new Date(Date.UTC(2026, 10, 20, 12, 0, ++revision)).toISOString() }
      return saved
    },
  }
  const store = createNoteStore(repository)
  await store.refresh()
  store.editPage(original.id, firstPageId, { title: 'Overview', body: 'First draft' })
  const second = store.addPage(original.id)
  store.editPage(original.id, second, { title: 'Hands', body: 'Second draft' })
  const third = store.addPage(original.id)
  await store.flush()
  await store.refresh()

  const reopened = createNoteStore(repository)
  await reopened.refresh()
  assert.deepEqual(pagesForNote(reopened.getSnapshot()[0].note), [
    { id: firstPageId, title: 'Overview', body: 'First draft' },
    { id: second, title: 'Hands', body: 'Second draft' },
    { id: third, title: '', body: '' },
  ])

  assert.equal(store.navigateHistory(original.id, third, 'undo'), undefined)
  store.navigateHistory(original.id, second, 'undo')
  await store.flush()
  assert.equal(saved.pages.extra[0].body, '')
  assert.equal(saved.pages.extra[0].title, 'Hands')
  assert.equal(saved.body, 'First draft')

  store.navigateHistory(original.id, firstPageId, 'undo')
  store.navigateHistory(original.id, second, 'redo')
  await store.flush()
  assert.equal(saved.body, original.body)
  assert.equal(saved.pages.extra[0].body, 'Second draft')
})

test('moving the original page preserves its content, ID and undo history across saves', async () => {
  let saved = original
  const repository = {
    list: async () => [saved],
    save: async (id, text) => {
      saved = { ...structuredClone(text), id, updated_at: new Date().toISOString() }
      return saved
    },
  }
  const store = createNoteStore(repository)
  await store.refresh()
  const second = store.addPage(original.id)
  const third = store.addPage(original.id)
  store.editPage(original.id, firstPageId, { title: 'Overview', body: 'Original edit' })
  store.editPage(original.id, second, { title: 'Review', body: 'Second body' })
  await store.flush()
  const before = saved
  store.movePage(original.id, firstPageId, 1)
  await store.flush()
  assert.equal(sameNoteText(saved, before), false)
  assert.equal(saved.body, 'Original edit')
  assert.equal(saved.pages.firstTitle, 'Overview')
  assert.deepEqual(saved.pages.extra, before.pages.extra)

  await store.refresh()
  const reopened = createNoteStore(repository)
  await reopened.refresh()
  assert.deepEqual(pagesForNote(reopened.getSnapshot()[0].note).map(page => page.id), [second, firstPageId, third])

  store.movePage(original.id, third, -1)
  store.navigateHistory(original.id, firstPageId, 'undo')
  const appended = store.addPage(original.id)
  await store.flush()
  assert.deepEqual(pagesForNote(saved).map(page => page.id), [second, third, firstPageId, appended])
  assert.equal(saved.body, original.body)
  assert.equal(saved.pages.extra[0].body, 'Second body')
})
