import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BookOpen, Calculator, ChartColumn, Grid3X3, Layers3, NotebookPen, Spade } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { Replayer } from './Replayer.tsx'
import { EquityCalculator } from './EquityCalculator.tsx'
import { Library } from './Library.tsx'
import { calculationLibrary, handLibrary, supabase, type SavedCalculation, type SavedHand } from './library.ts'
import './styles.css'

const FlopReports = lazy(() => import('./FlopReports.tsx'))
const FlopViewer = lazy(() => import('./FlopViewer.tsx'))
const Notes = lazy(() => import('./Notes.tsx'))
const PreflopViewer = lazy(() => import('./PreflopViewer.tsx'))

const tabs = [
  { id: 'replayer', label: 'Replayer', name: 'Hand Replayer', Icon: Spade },
  { id: 'equity', label: 'Equity', name: 'Equity Calculator', Icon: Calculator },
  { id: 'preflop', label: 'Preflop', name: 'Preflop Viewer', Icon: Grid3X3 },
  { id: 'flop-viewer', label: 'Flop Viewer', compactLabel: 'Flop', name: 'Flop Viewer', Icon: Layers3 },
  { id: 'flop-reports', label: 'Flop Reports', compactLabel: 'Reports', name: 'Flop Reports', Icon: ChartColumn },
  { id: 'notes', label: 'Notes', name: 'Notes', Icon: NotebookPen },
  { id: 'library', label: 'Library', name: 'Library', Icon: BookOpen },
] as const

function tabFromHash() {
  return tabs.find(tab => '#' + tab.id === window.location.hash)?.id ?? 'replayer'
}

function Workspace({ session }: { session: Session | null }) {
  const [tool, setTool] = useState(tabFromHash)
  const [openedTabs, setOpenedTabs] = useState(() => new Set([tool]))
  const [hand, setHand] = useState<SavedHand | null>(null)
  const [calculation, setCalculation] = useState<SavedCalculation | null>(null)
  const [handVersion, resetHand] = useState(0)
  const [calculationVersion, resetCalculation] = useState(0)
  const [deletedHandId, setDeletedHandId] = useState<string | null>(null)
  const [deletedCalculationId, setDeletedCalculationId] = useState<string | null>(null)

  useEffect(() => {
    const change = () => {
      const tab = tabFromHash()
      setTool(tab)
      if (tab === 'preflop' || tab === 'flop-reports' || tab === 'flop-viewer' || tab === 'notes') {
        setOpenedTabs(opened => opened.has(tab) ? opened : new Set(opened).add(tab))
      }
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])

  function openHand(row: SavedHand) {
    setHand(row)
    resetHand(version => version + 1)
    window.location.hash = 'replayer'
  }

  function openCalculation(row: SavedCalculation) {
    setCalculation(row)
    resetCalculation(version => version + 1)
    window.location.hash = 'equity'
  }

  async function removeHand(id: string) {
    if (!session) return
    await handLibrary(session.user.id).remove(id)
    setDeletedHandId(id)
  }

  async function removeCalculation(id: string) {
    if (!session) return
    await calculationLibrary(session.user.id).remove(id)
    setDeletedCalculationId(id)
  }

  return <>
    <header className="site-header">
      <nav className="app-nav" aria-label="Poker tools">
        {tabs.map(tab => {
          const { id, label, name, Icon } = tab
          const compactLabel = 'compactLabel' in tab ? tab.compactLabel : undefined
          return <a key={id} className={tool === id ? 'active' : ''} aria-current={tool === id ? 'page' : undefined} href={'#' + id} aria-label={name}>
            <Icon size={18} aria-hidden="true" />
            <span className={compactLabel ? 'app-nav-wide-label' : undefined}>{label}</span>
            {compactLabel && <span className="app-nav-compact-label">{compactLabel}</span>}
          </a>
        })}
      </nav>
    </header>
    <main className={tool === 'equity' ? 'main-wrap equity-view' : 'main-wrap'} data-tool={tool}>
      <div hidden={tool !== 'replayer'}><Replayer key={handVersion} userId={session?.user.id} initialHand={hand} deletedHandId={deletedHandId} /></div>
      <div hidden={tool !== 'equity'}><EquityCalculator key={calculationVersion} userId={session?.user.id} initialCalculation={calculation} deletedCalculationId={deletedCalculationId} /></div>
      {openedTabs.has('preflop') && <div hidden={tool !== 'preflop'}>
        <Suspense fallback={<p role="status">Loading preflop viewer…</p>}><PreflopViewer /></Suspense>
      </div>}
      {openedTabs.has('flop-viewer') && <div hidden={tool !== 'flop-viewer'}>
        <Suspense fallback={<p role="status">Loading flop viewer…</p>}><FlopViewer userId={session?.user.id} /></Suspense>
      </div>}
      {openedTabs.has('flop-reports') && <div hidden={tool !== 'flop-reports'}>
        <Suspense fallback={<p role="status">Loading flop reports…</p>}><FlopReports /></Suspense>
      </div>}
      {openedTabs.has('notes') && <div hidden={tool !== 'notes'}>
        <Suspense fallback={<p role="status">Loading notes…</p>}><Notes userId={session?.user.id} /></Suspense>
      </div>}
      {tool === 'library' && <Library session={session} openHand={openHand} openCalculation={openCalculation} removeHand={removeHand} removeCalculation={removeCalculation} />}
    </main>
  </>
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const previousUser = useRef<string | undefined>(undefined)
  const [workspaceKey, resetWorkspace] = useState(0)
  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (previousUser.current && previousUser.current !== next?.user.id) resetWorkspace(key => key + 1)
      previousUser.current = next?.user.id
      setSession(next)
    })
    return () => subscription.unsubscribe()
  }, [])

  return <Workspace key={workspaceKey} session={session} />
}

createRoot(document.getElementById('root')!).render(<App />)
