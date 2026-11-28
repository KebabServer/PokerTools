import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BookOpen, Calculator, ChartColumn, Cpu, Grid3X3, Layers3, Network, NotebookPen, Spade } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { Replayer } from './Replayer.tsx'
import { EquityCalculator } from './EquityCalculator.tsx'
import { Library } from './Library.tsx'
import { SignIn } from './SignIn.tsx'
import { calculationLibrary, handLibrary, supabase, type SavedCalculation, type SavedHand } from './library.ts'
import { noteIdFromHref } from './noteMarkdown.ts'
import './styles.css'

const FlopReports = lazy(() => import('./FlopReports.tsx'))
const FlopViewer = lazy(() => import('./FlopViewer.tsx'))
const Notes = lazy(() => import('./Notes.tsx'))
const PreflopViewer = lazy(() => import('./PreflopViewer.tsx'))
const GtoLibrary = lazy(() => import('./GtoLibrary.tsx'))
const TurnRiverLab = lazy(() => import('./TurnRiverLab.tsx'))

const tabs = [
  { id: 'replayer', label: 'Replayer', compactLabel: 'Replay', name: 'Hand Replayer', Icon: Spade },
  { id: 'equity', label: 'Equity', name: 'Equity Calculator', Icon: Calculator },
  { id: 'preflop', label: 'Preflop', name: 'Preflop Viewer', Icon: Grid3X3 },
  { id: 'gto-library', label: 'GTO Library', compactLabel: 'GTO', name: 'GTO Library', Icon: Network },
  { id: 'flop-viewer', label: 'Flop Viewer', compactLabel: 'Flop', name: 'Flop Viewer', Icon: Layers3 },
  { id: 'flop-reports', label: 'Flop Reports', compactLabel: 'Reports', name: 'Flop Reports', Icon: ChartColumn },
  { id: 'solver', label: 'Solver', name: 'Solver', Icon: Cpu },
  { id: 'notes', label: 'Notes', name: 'Notes', Icon: NotebookPen },
  { id: 'library', label: 'Library', name: 'Library', Icon: BookOpen },
] as const

function tabFromHash() {
  if (noteIdFromHref(window.location.hash)) return 'notes'
  return tabs.find(tab => '#' + tab.id === window.location.hash)?.id ?? 'replayer'
}

function Workspace({ session }: { session: Session }) {
  const [tool, setTool] = useState(tabFromHash)
  const [openedTabs, setOpenedTabs] = useState(() => new Set([tool]))
  const [hand, setHand] = useState<SavedHand | null>(null)
  const [calculation, setCalculation] = useState<SavedCalculation | null>(null)
  const [handVersion, resetHand] = useState(0)
  const [calculationVersion, resetCalculation] = useState(0)
  const [deletedHandId, setDeletedHandId] = useState<string | null>(null)
  const [deletedCalculationId, setDeletedCalculationId] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const flushNotes = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    const change = () => {
      const tab = tabFromHash()
      setTool(tab)
      if (tab === 'preflop' || tab === 'gto-library' || tab === 'flop-reports' || tab === 'flop-viewer' || tab === 'notes' || tab === 'solver') {
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

  async function signOut() {
    if (!supabase || signingOut) return
    setSigningOut(true)
    try {
      await flushNotes.current?.().catch(() => {
        throw new Error('A note couldn’t be saved. Open Notes to retry or save a copy, then sign out again.')
      })
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } finally {
      setSigningOut(false)
    }
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
      {openedTabs.has('gto-library') && <div hidden={tool !== 'gto-library'}>
        <Suspense fallback={<p role="status">Loading GTO Library…</p>}><GtoLibrary /></Suspense>
      </div>}
      {openedTabs.has('flop-viewer') && <div hidden={tool !== 'flop-viewer'}>
        <Suspense fallback={<p role="status">Loading flop viewer…</p>}><FlopViewer userId={session?.user.id} /></Suspense>
      </div>}
      {openedTabs.has('flop-reports') && <div hidden={tool !== 'flop-reports'}>
        <Suspense fallback={<p role="status">Loading flop reports…</p>}><FlopReports /></Suspense>
      </div>}
      {openedTabs.has('solver') && <div hidden={tool !== 'solver'}>
        <Suspense fallback={<p role="status">Loading solver…</p>}><TurnRiverLab userId={session.user.id} /></Suspense>
      </div>}
      {openedTabs.has('notes') && <div hidden={tool !== 'notes'}>
        <Suspense fallback={<p role="status">Loading notes…</p>}>
          <Notes userId={session.user.id} active={tool === 'notes'} locked={signingOut} flushRef={flushNotes} />
        </Suspense>
      </div>}
      {tool === 'library' && <Library session={session} openHand={openHand} openCalculation={openCalculation} removeHand={removeHand}
        removeCalculation={removeCalculation} signOut={signOut} signingOut={signingOut} flushNotes={() => flushNotes.current?.()} />}
    </main>
  </>
}

function App() {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  const [accessProblem, setAccessProblem] = useState('')
  useEffect(() => {
    const client = supabase
    if (!client) return
    let checkedUser: string | undefined
    let revision = 0
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      const request = ++revision
      if (!next || next.user.is_anonymous) {
        checkedUser = undefined
        setAccessProblem('')
        setSession(null)
        return
      }
      if (checkedUser === next.user.id) {
        setSession(next)
        return
      }
      setSession(undefined)
      setAccessProblem('')
      async function checkAccess() {
        if (!next) return
        const { data, error } = await client!.auth.getUser(next.access_token)
        if (request !== revision) return
        const valid = !error && data.user?.id === next.user.id && !data.user.is_anonymous
        if (!valid) {
          setSession(null)
          return
        }
        const { data: member, error: membershipError } = await client!.from('pokertools_members')
          .select('user_id').eq('user_id', next.user.id).maybeSingle()
        if (request !== revision) return
        checkedUser = member && !membershipError ? next.user.id : undefined
        if (!checkedUser) setAccessProblem(membershipError ? 'Couldn’t check access. Please sign in again.' : 'This account doesn’t have access to PokerTools.')
        setSession(checkedUser ? next : null)
      }
      void checkAccess().catch(() => {
        if (request !== revision) return
        setAccessProblem('Couldn’t check access. Please sign in again.')
        setSession(null)
      })
    })
    return () => { revision++; subscription.unsubscribe() }
  }, [])

  return session ? <Workspace key={session.user.id} session={session} /> : <SignIn loading={session === undefined} accessProblem={accessProblem} />
}

createRoot(document.getElementById('root')!).render(<App />)
