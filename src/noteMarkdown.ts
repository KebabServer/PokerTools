export type NoteFormat = 'heading' | 'bold' | 'italic' | 'bullet' | 'checklist' | 'quote' | 'heading3' | 'link'

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

export function countNoteWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}
