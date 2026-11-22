export type NoteFormat = 'heading' | 'bold' | 'italic' | 'bullet' | 'checklist' | 'quote' | 'heading3' | 'link'
export type NoteTableSize = { columns: number; rows: number }

const formats = {
  heading: ['## ', '', 'Heading'],
  bold: ['**', '**', 'text'],
  italic: ['*', '*', 'text'],
  bullet: ['- ', '', 'List item'],
  checklist: ['- [ ] ', '', 'Task'],
  quote: ['> ', '', 'Quote'],
  heading3: ['### ', '', 'Heading'],
  link: ['[', '](https://)', 'Link text'],
} as const

export function formatNote(text: string, start: number, end: number, format: NoteFormat) {
  const [prefix, suffix, placeholder] = formats[format]
  const selection = text.slice(start, end) || placeholder
  const label = format === 'link' ? selection.replace(/[\[\]\\]/g, '\\$&').replace(/\n/g, ' ') : selection
  const position = start + prefix.length + (format === 'link' ? label.length + 2 : 0)
  return {
    text: text.slice(0, start) + prefix + label + suffix + text.slice(end),
    start: position,
    end: position + (format === 'link' ? 'https://'.length : label.length),
  }
}

export function insertNoteTable(text: string, start: number, end: number, { columns, rows }: NoteTableSize) {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const leadingBreak = before.match(/\n{0,2}$/)![0].length
  const trailingBreak = after.match(/^\n{0,2}/)![0].length
  const prefix = before ? '\n'.repeat(2 - leadingBreak) : ''
  const suffix = after ? '\n'.repeat(2 - trailingBreak) : '\n'
  const firstHeader = text.slice(start, end).trim().replace(/\s+/g, ' ').replace(/[\\|]/g, '\\$&') || 'Column 1'
  const headers = [firstHeader, ...Array.from({ length: columns - 1 }, (_, index) => 'Column ' + (index + 2))]
  const row = (cells: string[]) => '| ' + cells.join(' | ') + ' |'
  const separator = row(Array<string>(columns).fill('---'))
  const emptyRow = row(Array<string>(columns).fill(''))
  const table = [row(headers), separator, ...Array<string>(rows).fill(emptyRow)].join('\n')
  const position = start + prefix.length + 2
  return { text: before + prefix + table + suffix + after, start: position, end: position + firstHeader.length }
}

export function countNoteWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}
