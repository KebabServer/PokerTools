import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Calculator, Layers3, LockKeyhole, Spade } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { Replayer } from './Replayer.tsx'
import { EquityCalculator } from './EquityCalculator.tsx'
import { supabase } from './library.ts'
import './styles.css'

const toolFromHash = () => window.location.hash === '#equity' ? 'equity' : 'replayer'

function App() {
  const [tool, setTool] = useState(toolFromHash)
  const [session, setSession] = useState<Session | null>(null)
  const previousUser = useRef<string | undefined>(undefined)
  const [replayerKey, resetReplayer] = useState(0)
  const [libraryRequest, requestLibrary] = useState(0)
  useEffect(() => {
    const change = () => setTool(toolFromHash())
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (previousUser.current && previousUser.current !== next?.user.id) resetReplayer(key => key + 1)
      previousUser.current = next?.user.id
      setSession(next)
    })
    return () => subscription.unsubscribe()
  }, [])

  return <>
    <header className="site-header"><div className="site-inner">
      <a className="brand" href="#replayer" aria-label="PokerTools home"><span className="brand-mark"><Spade size={19} fill="currentColor" /></span>Poker<span>Tools</span></a>
      <nav aria-label="Poker tools">
        <a className={tool === 'replayer' ? 'active' : ''} aria-current={tool === 'replayer' ? 'page' : undefined} href="#replayer"><Layers3 size={17} /> Hand Replayer</a>
        <a className={tool === 'equity' ? 'active' : ''} aria-current={tool === 'equity' ? 'page' : undefined} href="#equity"><Calculator size={17} /> Equity Calculator</a>
      </nav>
      <button className="button library-link" onClick={() => { if (tool !== 'replayer') { window.location.hash = 'replayer'; setTool('replayer') }; requestLibrary(count => count + 1) }}><LockKeyhole size={15} /> <span>My library</span></button>
    </div></header>
    <main className="main-wrap">
      <div hidden={tool !== 'replayer'}><Replayer key={replayerKey} userId={session?.user.id} email={session?.user.email} libraryRequest={libraryRequest} signOut={async () => {
        const { error } = await supabase!.auth.signOut()
        if (error) throw error
      }} /></div>
      <div hidden={tool !== 'equity'}><EquityCalculator /></div>
    </main>
    <footer className="footer"><span>PokerTools</span><span>No-Limit Texas Hold’em</span></footer>
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
