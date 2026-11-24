import type { Element, ElementContent, Root } from 'hast'

// GFM cells are inline-only. Render bullet lines as a list while keeping each source row on one line.
export function noteTableLists() {
  return (root: Root) => {
    function visit(node: Root | Element) {
      if (node.type === 'element' && (node.tagName === 'td' || node.tagName === 'th')) {
        const lines: ElementContent[][] = [[]]
        for (const child of node.children) {
          if (child.type === 'raw' && /^<br\s*\/?\s*>$/i.test(child.value)) lines.push([])
          else lines.at(-1)!.push(child)
        }
        const bullets = lines.map(line => {
          const first = line[0]
          const marker = first?.type === 'text' && /^\s*[-+*](?:\s+|$)/.exec(first.value)
          if (!marker || first.type !== 'text') return null
          return { type: 'element', tagName: 'li', properties: {}, children: [{ ...first, value: first.value.slice(marker[0].length) }, ...line.slice(1)] } satisfies Element
        })
        if (bullets.length && bullets.every(item => item !== null)) {
          node.children = [{ type: 'element', tagName: 'ul', properties: {}, children: bullets }]
        }
        return
      }
      for (const child of node.children) if (child.type === 'element') visit(child)
    }
    visit(root)
  }
}
