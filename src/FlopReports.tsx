import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { FlopActionLabel, FlopReportChart } from './FlopReportChart.tsx'
import { FlopSizingTrainer, type FlopTrainingMode } from './FlopSizingTrainer.tsx'
import { parseFlopReport, type FlopBoardOrder, type FlopReport } from './flopReport.ts'
import { readStudyFile } from './studyFiles.ts'
import { flopReportGroups, flopReportLines, type FlopReportLine } from './flopReportCatalog.ts'
import './flop-reports.css'

const views = ['Reports', 'Trainer'] as const
type ReportView = typeof views[number]
type LoadedReport = { file: string; data: FlopReport | null }

export default function FlopReports() {
  const [view, setView] = useState<ReportView>('Reports')
  const [boardOrder, setBoardOrder] = useState<FlopBoardOrder>('default')
  const [trainingMode, setTrainingMode] = useState<FlopTrainingMode>('Sizing')
  const [groupIndex, setGroup] = useState(0)
  const [matchupId, setMatchup] = useState(flopReportGroups[0].matchups[0].id)
  const [lineId, setLine] = useState<FlopReportLine>('cbet')
  const [loaded, setLoaded] = useState<LoadedReport | null>(null)
  const [attempt, retry] = useState(0)
  const group = flopReportGroups[groupIndex]
  const matchup = group.matchups.find(item => item.id === matchupId) ?? group.matchups[0]
  const line = matchup.lines.includes(lineId) ? lineId : matchup.lines[0]
  const file = `${group.id}-${matchup.id}-${line}.csv`
  const current = loaded?.file === file ? loaded : null
  const report = current?.data

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = parseFlopReport(await readStudyFile('flop-reports/' + file, controller.signal))
        if (!controller.signal.aborted) setLoaded({ file, data })
      } catch {
        if (!controller.signal.aborted) setLoaded({ file, data: null })
      }
    }
    void load()
    return () => controller.abort()
  }, [file, attempt])

  function moveView(event: KeyboardEvent<HTMLDivElement>) {
    let next: ReportView
    switch (event.key) {
      case 'Home': next = 'Reports'; break
      case 'End': next = 'Trainer'; break
      case 'ArrowLeft':
      case 'ArrowRight': next = view === 'Reports' ? 'Trainer' : 'Reports'; break
      default: return
    }
    event.preventDefault()
    setView(next)
    event.currentTarget.querySelector<HTMLButtonElement>('#flop-tab-' + next)?.focus()
  }

  return <div className="flop-reports">
    <div className="tool-heading">
      <h1>Flop Reports</h1>
      <div className="flop-report-tabs" role="tablist" aria-label="Flop Reports views" onKeyDown={moveView}>
        {views.map(item => <button type="button" role="tab" key={item} id={'flop-tab-' + item}
          aria-controls={'flop-view-' + item} aria-selected={view === item} tabIndex={view === item ? 0 : -1}
          onClick={() => setView(item)}>{item}</button>)}
      </div>
    </div>
    <div className="panel flop-report-controls">
      <div className="flop-pot-types" role="group" aria-label="Pot type">
        {flopReportGroups.map((item, index) => <button type="button" key={item.id}
          aria-pressed={groupIndex === index} onClick={() => setGroup(index)}>{item.label}</button>)}
      </div>
      <label>Matchup
        <select value={matchup.id} onChange={event => setMatchup(event.target.value)}>
          {group.matchups.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label>Line
        <select value={line} onChange={event => setLine(event.target.value as FlopReportLine)}>
          {matchup.lines.map(item => <option key={item} value={item}>{flopReportLines[item]}</option>)}
        </select>
      </label>
    </div>

    {!current && <p role="status" className="flop-report-status">Loading report…</p>}
    {current && !report && <div className="flop-report-status">
      <p className="error" role="alert">Couldn’t load this report.</p>
      <button className="button" type="button" onClick={() => { setLoaded(null); retry(count => count + 1) }}>Retry</button>
    </div>}
    <div role="tabpanel" id="flop-view-Reports" aria-labelledby="flop-tab-Reports" hidden={view !== 'Reports'}>
      {report && <>
        <div className="flop-report-summary">
          <ul className="flop-legend" aria-label="Action frequencies">
            {report.actions.map(action => <li key={action.label}><FlopActionLabel action={action} /></li>)}
          </ul>
          <div className="flop-report-chart-options">
            <span>{report.boardCount.toLocaleString('en')} flops</span>
            <label>Sort by
              <select value={boardOrder} onChange={event => setBoardOrder(event.target.value === 'low' ? 'low' : 'default')}>
                <option value="default">High / pair rank</option>
                <option value="low">Lowest card</option>
              </select>
            </label>
          </div>
        </div>
        <p className="flop-report-hint">Hover or tap a bar to inspect the flop.</p>
        <span className="sr-only" id="flop-chart-keys">Press Enter to open details. Use the left and right arrow keys to step through flops.</span>
        <div className="flop-charts" key={file}>
          {report.groups.filter(texture => texture.boards.length).map(texture =>
            <FlopReportChart key={texture.id} group={texture} actions={report.actions} order={boardOrder} />
          )}
        </div>
      </>}
    </div>
    <div role="tabpanel" id="flop-view-Trainer" aria-labelledby="flop-tab-Trainer" hidden={view !== 'Trainer'}>
      {report && <FlopSizingTrainer key={file} report={report} mode={trainingMode} setMode={setTrainingMode} />}
    </div>
  </div>
}
