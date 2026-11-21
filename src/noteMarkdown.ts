export type NoteFormat = 'paragraph' | 'bold' | 'italic' | 'bullet' | 'checklist' | 'quote' | 'heading' | 'link'

const blockFormats = {
  paragraph: '',
  bullet: '- ',
  checklist: '- [ ] ',
  quote: '> ',
  heading: '## ',
}

const blockMarker = /^(#{1,6}[ \t]+|>[ \t]*|(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/

export function formatNote(text: string, start: number, end: number, format: NoteFormat) {
  const selected = text.slice(start, end)
  function replace(from: number, to: number, value: string, selectionStart: number, selectionEnd = selectionStart) {
    return { text: text.slice(0, from) + value + text.slice(to), start: from + selectionStart, end: from + selectionEnd }
  }

  if (format === 'bold' || format === 'italic') {
    const marker = format === 'bold' ? '**' : '_'
    if (selected && text.slice(start - marker.length, start) === marker && text.slice(end, end + marker.length) === marker) {
      return replace(start - marker.length, end + marker.length, selected, 0, selected.length)
    }
    if (selected.length > 2 * marker.length && selected.startsWith(marker) && selected.endsWith(marker)) {
      const plain = selected.slice(marker.length, -marker.length)
      return replace(start, end, plain, 0, plain.length)
    }
    const content = selected.trim() || (format === 'bold' ? 'bold text' : 'italic text')
    const leading = selected.match(/^\s*/)?.[0] ?? ''
    const trailing = selected.trim() ? selected.match(/\s*$/)?.[0] ?? '' : ''
    const cursor = leading.length + marker.length
    return replace(start, end, leading + marker + content + marker + trailing, cursor, cursor + content.length)
  }

  if (format === 'link') {
    const label = (selected || 'Link text').replace(/[\[\]\\]/g, '\\$&').replace(/\n/g, ' ')
    const beforeUrl = '[' + label + ']('
    const url = 'https://'
    return replace(start, end, beforeUrl + url + ')', beforeUrl.length, beforeUrl.length + url.length)
  }

  const from = start > 0 ? text.lastIndexOf('\n', start - 1) + 1 : 0
  const nextBreak = text.indexOf('\n', end > start && text[end - 1] === '\n' ? end - 1 : end)
  const to = nextBreak < 0 ? text.length : nextBreak
  const lines = text.slice(from, to).split('\n')
  const prefix = blockFormats[format]
  const withoutIndent = lines.map(line => line.trimStart())
  const active = Boolean(prefix) && withoutIndent.filter(line => line.trim()).length > 0
    && withoutIndent.filter(line => line.trim()).every(line => {
      if (format === 'heading') return /^#{1,6}[ \t]+/.test(line)
      if (format === 'checklist') return /^[-+*][ \t]+\[[ xX]\][ \t]+/.test(line)
      if (format === 'bullet') return /^[-+*][ \t]+(?!\[[ xX]\])/.test(line)
      return line.startsWith(prefix)
    })
  const value = lines.map((line, index) => {
    const content = withoutIndent[index]
    if (lines.length > 1 && !content) return line
    const marker = content.match(blockMarker)?.[0] ?? ''
    const indent = line.slice(0, line.length - content.length)
    return indent + (active ? '' : prefix) + content.slice(marker.length)
  }).join('\n')
  if (start === end) {
    const caret = Math.max(0, Math.min(value.length, start - from + value.length - (to - from)))
    return replace(from, to, value, caret)
  }
  return replace(from, to, value, 0, value.length)
}

export function countNoteWords(text: string) {
  const words = text.replace(/^[ \t]*[-+*][ \t]+\[[ xX]\][ \t]+/gm, '').replace(/\[([^\[\]\n]*)\]\([^()\n]*\)/g, '$1')
  return words.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}
