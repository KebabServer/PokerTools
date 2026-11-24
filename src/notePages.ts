import type { NoteText } from './notes.ts'

export const firstPageId = 'first'

export type NotePage = { id: string; title: string; body: string }
export type NotePages = { firstTitle: string; extra: NotePage[] }
export type NotePageText = Pick<NotePage, 'title' | 'body'>

export const emptyNotePages: NotePages = { firstTitle: '', extra: [] }

export function pagesForNote({ body, pages }: { body: string; pages: NotePages }): NotePage[] {
  return [{ id: firstPageId, title: pages.firstTitle, body }, ...pages.extra]
}

function sameNotePages(a: NotePages, b: NotePages) {
  return a === b || (a.firstTitle === b.firstTitle && a.extra.length === b.extra.length && a.extra.every((page, index) => {
    const other = b.extra[index]
    return page.id === other.id && page.title === other.title && page.body === other.body
  }))
}
export function sameNoteText(a: NoteText, b: NoteText) {
  return a.title === b.title && a.body === b.body && a.pinned === b.pinned && sameNotePages(a.pages, b.pages)
}
