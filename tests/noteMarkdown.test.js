import assert from 'node:assert/strict'
import test from 'node:test'
import { countNoteWords, formatNote } from '../src/noteMarkdown.ts'

test('Title applies a level-three heading and toggles it off', () => {
  const title = formatNote('## Study plan\nNext line', 5, 5, 'title')
  assert.deepEqual(title, { text: '### Study plan\nNext line', start: 6, end: 6 })
  assert.equal(formatNote(title.text, title.start, title.end, 'title').text, 'Study plan\nNext line')
  assert.deepEqual(formatNote('', 0, 0, 'title'), { text: '### ', start: 4, end: 4 })
})

test('inline formatting preserves the selection and toggles off without removing text', () => {
  const formatted = formatNote('  River lead ', 0, 13, 'bold')
  assert.deepEqual(formatted, { text: '  **River lead** ', start: 4, end: 14 })
  assert.equal(formatNote(formatted.text, formatted.start, formatted.end, 'bold').text, '  River lead ')
})

test('list formatting updates selected lines without nesting existing markers or changing the following line', () => {
  const text = '- Check\n- Call\nUntouched'
  const formatted = formatNote(text, 0, text.indexOf('Untouched'), 'checklist')
  assert.equal(formatted.text, '- [ ] Check\n- [ ] Call\nUntouched')
  assert.equal(formatNote(formatted.text, formatted.start, formatted.end, 'checklist').text, 'Check\nCall\nUntouched')
})

test('links select the replacement URL and word count ignores Markdown task and link syntax', () => {
  const link = formatNote('My [link]', 0, 9, 'link')
  assert.equal(link.text, '[My \\[link\\]](https://)')
  assert.equal(link.text.slice(link.start, link.end), 'https://')
  assert.equal(countNoteWords('## Notes\n- [x] Reviewed [this hand](https://example.com)\n**Well played**'), 6)
})
