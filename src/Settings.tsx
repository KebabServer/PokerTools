import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { supabase } from './library.ts'

type ProjectUsage = { database_bytes: number; storage_bytes: number }

const freeDatabaseBytes = 500_000_000
const usageDashboard = 'https://supabase.com/dashboard/org/_/usage'
const byteUnits = [[1e12, 'TB'], [1e9, 'GB'], [1e6, 'MB'], [1e3, 'kB']] as const
const usageNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

function formatBytes(bytes: number) {
  const [factor, unit] = byteUnits.find(([factor]) => bytes >= factor) ?? [1, 'B']
  return usageNumber.format(bytes / factor) + ' ' + unit
}

function validBytes(bytes: unknown): bytes is number {
  return typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0
}

function SupabaseUsage() {
  const [usage, setUsage] = useState<ProjectUsage | null>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const request = new AbortController()
    async function readUsage() {
      if (!supabase) throw new Error('Supabase is unavailable.')
      const { data, error } = await supabase.rpc('pokertools_project_usage').abortSignal(request.signal).single()
        .overrideTypes<ProjectUsage, { merge: false }>()
      if (error || !validBytes(data?.database_bytes) || !validBytes(data?.storage_bytes)) throw new Error('Usage is unavailable.')
      if (!request.signal.aborted) setUsage(data)
    }
    void readUsage().catch(() => {
      if (!request.signal.aborted) setUsage(null)
    })
    return () => request.abort()
  }, [attempt])

  return <section className="panel review-panel settings-usage" aria-labelledby="settings-usage-title">
    <h2 id="settings-usage-title">Supabase usage</h2>
    {usage ? <div className="settings-metrics">
      <div>
        <h3>Database size</h3>
        <p><strong>{formatBytes(usage.database_bytes)} used</strong> of {formatBytes(freeDatabaseBytes)} per project</p>
        <progress aria-label="Database usage against the Free Plan limit"
          value={Math.min(usage.database_bytes, freeDatabaseBytes)} max={freeDatabaseBytes} />
        <p>About {formatBytes(Math.max(0, freeDatabaseBytes - usage.database_bytes))} left on the Free Plan.</p>
      </div>
      <div>
        <h3>File storage</h3>
        <p><strong>{formatBytes(usage.storage_bytes)}</strong> stored in this project</p>
        <p>The Free Plan includes 1 GB shared across the organization.</p>
      </div>
    </div> : usage === null ? <div className="settings-usage-retry">
      <p role="status">Project usage is unavailable.</p>
      <button type="button" className="button small" onClick={() => { setUsage(undefined); setAttempt(value => value + 1) }}>Retry</button>
    </div> : <p role="status">Loading project usage…</p>}
    <div className="settings-usage-link">
      <p>See organization-wide storage, bandwidth, monthly active users, and other quotas in Supabase.</p>
      <a className="button small" href={usageDashboard} target="_blank" rel="noopener noreferrer">Open Supabase Usage <ExternalLink size={14} aria-hidden="true" /></a>
    </div>
  </section>
}

export function Settings({ email, signOut, signingOut }: { email?: string; signOut: () => Promise<void>; signingOut: boolean }) {
  const [problem, setProblem] = useState('')

  async function leave() {
    setProblem('')
    try {
      await signOut()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Couldn’t sign out.')
    }
  }

  return <div className="settings-workspace">
    <div className="tool-heading"><h1>Settings</h1></div>
    <div className="settings-sections">
      <section className="panel review-panel" aria-labelledby="settings-account-title">
        <div className="settings-account">
          <div>
            <h2 id="settings-account-title">Account</h2>
            {email && <p>{email}</p>}
          </div>
          <button type="button" className="button" disabled={signingOut} onClick={() => void leave()}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
        </div>
        {problem && <p className="error" role="alert">{problem}</p>}
      </section>
      <SupabaseUsage />
    </div>
  </div>
}
