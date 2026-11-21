import { useEffect, useState } from 'react'
import { FlopActionLabel, FlopReportChart } from './FlopReportChart.tsx'
import { parseFlopReport } from './flopReport.ts'
import { readStudyFile } from './studyFiles.ts'
import { flopReportGroups, flopReportLines, type FlopReportLine } from './flopReportCatalog.ts'
import './flop-reports.css'

type LoadedReport = { file: string; data: ReturnType<typeof parseFlopReport> | null }

export default function FlopReports() {
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

  return <div className="flop-reports">
    <div className="tool-heading"><h1>Flop Reports</h1></div>
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
    {report && <>
      <div className="flop-report-summary">
        <ul className="flop-legend" aria-label="Action frequencies">
          {report.actions.map(action => <li key={action.label}><FlopActionLabel action={action} /></li>)}
        </ul>
        <span>{report.boardCount.toLocaleString('en')} flops</span>
      </div>
      <p className="flop-report-hint">Hover or tap a bar to inspect the flop.</p>
      <span className="sr-only" id="flop-chart-keys">Press Enter to open details. Use the left and right arrow keys to step through flops.</span>
      <div className="flop-charts" key={file}>
        {report.groups.filter(texture => texture.boards.length).map(texture =>
          <FlopReportChart key={texture.id} group={texture} actions={report.actions} />
        )}
      </div>
    </>}
  </div>
}
