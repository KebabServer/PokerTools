import type { NoteText } from './notes.ts'

export const firstPageId = 'first'

export type NotePage = { id: string; title: string; body: string }
export type NotePages = { firstTitle: string; extra: NotePage[]; firstPosition?: number }
export type NotePageText = Pick<NotePage, 'title' | 'body'>

export const emptyNotePages: NotePages = { firstTitle: '', extra: [] }

export function pagesForNote({ body, pages }: { body: string; pages: NotePages }): NotePage[] {
  // Keep the original page's content and ID in their existing storage fields.
  const position = pages.firstPosition ?? 0
  const ordered = [...pages.extra]
  ordered.splice(Number.isInteger(position) && position >= 0 ? position : 0, 0, { id: firstPageId, title: pages.firstTitle, body })
  return ordered
}

function sameNotePages(a: NotePages, b: NotePages) {
  return a === b || (a.firstTitle === b.firstTitle && (a.firstPosition ?? 0) === (b.firstPosition ?? 0) && a.extra.length === b.extra.length && a.extra.every((page, index) => {
    const other = b.extra[index]
    return page.id === other.id && page.title === other.title && page.body === other.body
  }))
}
export function sameNoteText(a: NoteText, b: NoteText) {
  return a.title === b.title && a.body === b.body && a.pinned === b.pinned && sameNotePages(a.pages, b.pages)
}
