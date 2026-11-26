import { useLayoutEffect, useRef } from 'react'
import { readStudyFile } from './studyFiles.ts'
import { createSolverStorage, type SavedSolution } from './turnRiverLab/storage.ts'
import solverPage from './turnRiverLab/solver.html?raw'

const assetBase = new URL(import.meta.env.BASE_URL + 'turn-river-lab/', window.location.origin).href
const documentSource = solverPage.replaceAll('LAB_ASSET_BASE', assetBase)
const bridgeScope = 'poker-tools-turn-river-lab'

function solutionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80
}

function savedSolution(value: unknown): value is SavedSolution {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<SavedSolution>
  return solutionId(row.id) && typeof row.label === 'string' && row.label.length <= 256
    && !!row.data && typeof row.data === 'object'
}

export default function TurnRiverLab({ userId }: { userId: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  useLayoutEffect(() => {
    const controller = new AbortController()
    const storage = createSolverStorage(userId)
    async function request(action: unknown, value: unknown) {
      switch (action) {
        case 'flop-library':
          return readStudyFile('turn-river-lab/flop-library.tsv', controller.signal)
            .catch(() => { throw new Error('Couldn’t load the flop library.') })
        case 'list-solutions':
          return storage.list()
        case 'load-solution':
          if (solutionId(value)) return storage.load(value)
          break
        case 'save-solution':
          if (savedSolution(value)) return storage.save(value)
          break
        case 'delete-solution':
          if (solutionId(value)) return storage.remove(value)
          break
      }
      throw new Error('Invalid solver request.')
    }

    function receive(event: MessageEvent) {
      const frame = frameRef.current
      const message = event.data
      if (!frame || event.source !== frame.contentWindow || event.origin !== 'null' || message?.scope !== bridgeScope) return
      const port = event.ports[0]
      if (!port) return
      void request(message.action, message.value)
        .then(value => port.postMessage({ ok: true, value }))
        .catch(error => port.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Solver request failed.' }))
        .finally(() => port.close())
    }

    window.addEventListener('message', receive)
    return () => {
      controller.abort()
      window.removeEventListener('message', receive)
    }
  }, [userId])

  return <iframe ref={frameRef} className="turn-river-lab-frame" title="TurnRiverLab solver"
    srcDoc={documentSource} referrerPolicy="no-referrer"
    sandbox="allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox"
    allow="clipboard-write *" />
}
