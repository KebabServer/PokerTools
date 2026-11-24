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

const escapeLinkLabel = (text: string) => text.replace(/[\[\]\\]/g, '\\$&').replace(/\r?\n/g, ' ')

export function noteHref(id: string) {
  return '#notes/' + id
}

export function noteIdFromHref(href: string) {
  const match = /^#notes\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i.exec(href)
  return match?.[1].toLowerCase() ?? null
}

export function formatNote(text: string, start: number, end: number, format: NoteFormat) {
  if (format === 'bullet') {
    const cell = tableCellAt(text, start, end)
    if (cell && cell.text.trim()) {
      if (/^[-+*]\s/.test(cell.text)) {
        const position = cell.start + cell.text.trimEnd().length
        const bullet = '<br>- List item'
        return { text: text.slice(0, position) + bullet + text.slice(position), start: position + 6, end: position + bullet.length }
      }
      return { text: text.slice(0, cell.start) + '- ' + text.slice(cell.start), start: Math.max(start, cell.start) + 2, end: Math.max(end, cell.start) + 2 }
    }
  }
  const [prefix, suffix, placeholder] = formats[format]
  const selection = text.slice(start, end) || placeholder
  const label = format === 'link' ? escapeLinkLabel(selection) : selection
  const position = start + prefix.length + (format === 'link' ? label.length + 2 : 0)
  return {
    text: text.slice(0, start) + prefix + label + suffix + text.slice(end),
    start: position,
    end: position + (format === 'link' ? 'https://'.length : label.length),
  }
}

function tableCellAt(text: string, start: number, end: number) {
  const lineStart = start ? text.lastIndexOf('\n', start - 1) + 1 : 0
  const lineEnd = text.indexOf('\n', start)
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd)
  const boundaries = [...line.matchAll(/\|/g)].map(pipe => pipe.index).filter(index =>
    (line.slice(0, index).match(/\\+$/)?.[0].length ?? 0) % 2 === 0,
  )
  if (!boundaries.length) return
  const divider = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/
  const before = text.slice(0, lineStart).split('\n').slice(0, -1)
  const after = lineEnd === -1 ? '' : text.slice(lineEnd + 1).split('\n', 1)[0]
  if (divider.test(line)) return
  while (before.length && !divider.test(before.at(-1)!) && before.at(-1)!.includes('|')) before.pop()
  if (!divider.test(after) && !(divider.test(before.at(-1) ?? '') && before.at(-2)?.includes('|'))) return
  const left = boundaries.filter(index => lineStart + index < start).at(-1) ?? -1
  const right = boundaries.find(index => lineStart + index >= start) ?? line.length
  if (end > lineStart + right || (left === -1 && line.startsWith('|')) || (right === line.length && line.endsWith('|'))) return
  const contents = line.slice(left + 1, right).trimStart()
  return { text: contents, start: lineStart + right - contents.length }
}

export function continueTableBullet(text: string, start: number, end: number) {
  const cell = tableCellAt(text, start, end)
  if (!cell || start < cell.start) return
  const before = cell.text.slice(0, start - cell.start)
  const item = before.split(/<br\s*\/?\s*>/i).at(-1)!
  if (/^[-+*]\s*$/.test(item) && !cell.text.slice(end - cell.start).trim()) {
    const marker = before.match(/(?:<br\s*\/?\s*>)?[-+*]\s*$/i)![0]
    const position = start - marker.length
    return { text: text.slice(0, position) + text.slice(end), start: position, end: position }
  }
  if (!/^[-+*]\s+\S/.test(item)) return
  const position = start + '<br>- '.length
  return { text: text.slice(0, start) + '<br>- ' + text.slice(end), start: position, end: position }
}

export function insertNoteLink(text: string, range: { start: number; end: number } | null, id: string, title: string) {
  const start = range?.start ?? text.length
  const end = range?.end ?? start
  const selected = text.slice(start, end).trim()
  const label = escapeLinkLabel(selected || title.trim() || 'Untitled note').replaceAll('|', '\\|')
  const prefix = range || !text ? '' : '\n'.repeat(text.endsWith('\n\n') ? 0 : text.endsWith('\n') ? 1 : 2)
  const link = '[' + label + '](' + noteHref(id) + ')'
  const caret = start + prefix.length + link.length
  return { text: text.slice(0, start) + prefix + link + text.slice(end), start: caret, end: caret }
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
