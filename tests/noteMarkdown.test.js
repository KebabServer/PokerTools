import assert from 'node:assert/strict'
import test from 'node:test'
import { countNoteWords, formatNote } from '../src/noteMarkdown.ts'

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
