import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { continueTableBullet, countNoteWords, formatNote, insertNoteLink, insertNoteTable, noteHref, noteIdFromHref } from '../src/noteMarkdown.ts'
import { noteTableLists } from '../src/noteTableLists.ts'

test('the Daymark heading buttons insert their matching levels and select the placeholder', () => {
  assert.deepEqual(formatNote('', 0, 0, 'heading'), { text: '## Heading', start: 3, end: 10 })
  assert.deepEqual(formatNote('Plan here', 0, 4, 'heading3'), { text: '### Plan here', start: 4, end: 8 })
})

test('format commands preserve text and select the formatted content', () => {
  assert.deepEqual(formatNote('a note', 2, 6, 'italic'), { text: 'a *note*', start: 3, end: 7 })
  assert.deepEqual(formatNote('', 0, 0, 'checklist'), { text: '- [ ] Task', start: 6, end: 10 })
})

test('Insert link selects the URL placeholder and the word count matches Daymark', () => {
  const link = formatNote('My [link]', 0, 9, 'link')
  assert.equal(link.text, '[My \\[link\\]](https://)')
  assert.equal(link.text.slice(link.start, link.end), 'https://')
  assert.equal(countNoteWords('  ## Notes\n- [x] Reviewed '), 5)
  assert.equal(countNoteWords('  \n '), 0)
})

test('table insertion uses the selected dimensions and selects the first header', () => {
  const table = insertNoteTable('', 0, 0, { columns: 2, rows: 3 })
  assert.equal(table.text, '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n|  |  |\n|  |  |\n')
  assert.equal(table.text.slice(table.start, table.end), 'Column 1')
})

test('table insertion preserves surrounding paragraphs and escapes pipes in the selected heading', () => {
  const selected = 'Pot | odds\nand equity'
  const before = 'Before\n'
  const table = insertNoteTable(before + selected + '\n\nAfter', before.length, before.length + selected.length, { columns: 1, rows: 1 })
  assert.equal(table.text, 'Before\n\n| Pot \\| odds and equity |\n| --- |\n|  |\n\nAfter')
  assert.equal(table.text.slice(table.start, table.end), 'Pot \\| odds and equity')
})

test('note links use a stable note ID and preserve an inline selection as the label', () => {
  const id = '80000000-0000-4000-8000-000000000001'
  const href = noteHref(id)
  assert.equal(noteIdFromHref(href), id)
  assert.equal(noteIdFromHref('#notes/other'), null)
  assert.equal(noteIdFromHref('https://example.com/' + href), null)

  const inline = insertNoteLink('See [A|B] next.', { start: 4, end: 9 }, id, 'A note')
  assert.equal(inline.text, 'See [\\[A\\|B\\]](' + href + ') next.')
  assert.equal(inline.text.slice(inline.start), ' next.')
  assert.equal(inline.start, inline.end)
  assert.equal(insertNoteLink('Start\n', null, id, 'My sub-note').text, 'Start\n\n[My sub-note](' + href + ')')
})

test('the bullet toolbar and Enter keep a table cell on a single source line', () => {
  const note = '| Plan | Result |\n| --- | --- |\n| A \\| B | Ready |'
  const start = note.indexOf('B |')
  const first = formatNote(note, start, start + 1, 'bullet')
  assert.equal(first.text, note.replace('A \\| B', '- A \\| B'))
  assert.equal(first.text.slice(first.start, first.end), 'B')

  const next = continueTableBullet(first.text, first.end, first.end)
  assert.equal(next.text, first.text.replace('B |', 'B<br>-  |'))
  assert.equal(next.text.slice(next.start), ' | Ready |')
  assert.equal(continueTableBullet(next.text, next.start, next.end).text, first.text)
  assert.equal(continueTableBullet('- ordinary list', 15, 15), undefined)
  assert.equal(formatNote(first.text, first.end, first.end, 'bullet').text, first.text.replace('B |', 'B<br>- List item |'))
})

test('table bullets render as a list and preserve inline formatting and neighboring cells', () => {
  const text = '| Plan | Result |\n| --- | --- |\n| - **One**<br>- [Two](https://example.com) | Ready |'
  const html = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm], rehypePlugins: [noteTableLists] }, text))
  assert.match(html, /<td><ul><li><strong>One<\/strong><\/li><li><a href="https:\/\/example\.com">Two<\/a><\/li><\/ul><\/td><td>Ready<\/td>/)
})
