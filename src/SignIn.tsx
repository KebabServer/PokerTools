import { useState, type FormEvent } from 'react'
import { supabase } from './library.ts'

export function SignIn({ loading, accessProblem }: { loading: boolean; accessProblem: string }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setProblem('')
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: String(data.get('email')),
        password: String(data.get('password')),
      })
      if (error) throw error
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Couldn’t sign in.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="main-wrap login-page">
    <section className="panel review-panel login-panel">
      <h1>PokerTools</h1>
      {loading ? <p role="status">Checking your session…</p> : supabase ? <form onSubmit={authenticate} className="login-form">
        <label>Email<input type="email" name="email" autoComplete="username" required /></label>
        <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>
        {(problem || accessProblem) && <p className="error" role="alert">{problem || accessProblem}</p>}
        <button className="button primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form> : <p className="error">Supabase setup is required to sign in.</p>}
    </section>
  </main>
}
