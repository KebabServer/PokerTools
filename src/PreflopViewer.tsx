import { Fragment, useEffect, useState } from 'react'
import {
  mixBackground, mixForHand, parsePreflopPresets, preflopColors, preflopHands, preflopPositionRows, preflopSpotGroups, preflopStudyPath,
  type PreflopPreset, type PreflopSpot,
} from './preflop.ts'
import { readStudyFile } from './studyFiles.ts'
import { PreflopHandGrid } from './PreflopHandGrid.tsx'

const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 })
const colorLegend = [
  { label: 'Raise', color: preflopColors.raise },
  { label: 'Call', color: preflopColors.call },
  { label: 'Fold', color: preflopColors.fold },
  { label: 'All in', color: preflopColors.allIn },
  { label: '3-bet then call', color: preflopColors.reraiseCall },
  { label: 'Unlisted', color: preflopColors.unlisted },
]

function SpotMatrix({ stage, preset, hand, spotId, onChange }: {
  stage: '3-bet' | '4-bet'
  preset: PreflopPreset
  hand: number
  spotId: string
  onChange: (spotId: string) => void
}) {
  const isThreeBet = stage === '3-bet'
  const heading = isThreeBet ? stage : 'RFI / 4-bet'
  const headingId = isThreeBet ? 'preflop-three-bet' : 'preflop-four-bet'

  function spotButton(spot: PreflopSpot, text: string, action: string) {
    const mix = mixForHand(preset.ranges.get(spot.id) ?? [], hand)
    const name = action === 'RFI' ? spot.label : spot.label + ' · ' + action
    const summary = mix.map(item => item.label + ' ' + percent.format(item.frequency)).join('\n')
    return <button key={spot.id} type="button" className="preflop-cell"
      disabled={!mix.length} aria-pressed={spot.id === spotId} aria-label={name}
      title={name + '\n' + (summary || 'No range in this preset')}
      style={{ backgroundImage: mixBackground(mix) }} onClick={() => onChange(spot.id)}>
      {text}
    </button>
  }

  return <section className="panel preflop-position-panel" aria-labelledby={headingId}>
    <div className="preflop-position-heading">
      <h2 id={headingId}>{heading}</h2>
      <span>{preflopHands[hand]}</span>
    </div>
    <div className="preflop-position-grid">
      {preflopPositionRows.map(row => <Fragment key={row.opener}>
        {isThreeBet
          ? <span className="preflop-opener">vs {row.opener}</span>
          : spotButton(row.opening, row.opener + ' RFI', 'RFI')}
        {row.responses.map((matchup, index) => {
          if (!matchup) return <span key={index} className="preflop-empty" aria-hidden="true" />
          return spotButton(isThreeBet ? matchup.threeBet : matchup.fourBet, matchup.opponent, stage)
        })}
      </Fragment>)}
    </div>
  </section>
}

function RangeViewer({ presets }: { presets: PreflopPreset[] }) {
  const [presetIndex, setPreset] = useState(0)
  const [spotId, setSpot] = useState(preflopPositionRows[0].opening.id)
  const [handIndex, setHand] = useState(0)
  const preset = presets[presetIndex]
  const actions = preset.ranges.get(spotId) ?? []
  const selectedMix = mixForHand(actions, handIndex)
  const total = selectedMix.reduce((sum, item) => sum + item.frequency, 0)

  return <>
    <div className="preflop-layout">
      <section className="panel preflop-chart" aria-label="Preflop range chart">
        <PreflopHandGrid actions={actions} hand={handIndex} onHandChange={setHand} />
      </section>
      <div className="preflop-positions">
        <SpotMatrix stage="4-bet" preset={preset} hand={handIndex} spotId={spotId} onChange={setSpot} />
        <SpotMatrix stage="3-bet" preset={preset} hand={handIndex} spotId={spotId} onChange={setSpot} />
      </div>
    </div>
    <div className="preflop-details">
      {selectedMix.length ? <ul className="preflop-actions" aria-label="Action frequencies for selected hand" aria-live="polite">
        {selectedMix.map(({ label, color, frequency }) => <li key={label}>
          <span className="preflop-swatch" style={{ backgroundColor: color }} aria-hidden="true" />
          {label} <strong>{percent.format(frequency)}</strong>
        </li>)}
      </ul> : <p className="preflop-note" role="status">This preset has no range for the selected spot.</p>}
      {total > 1.0005 && <p className="preflop-note">
        The export totals {percent.format(total)} for {preflopHands[handIndex]}. The chart scales the colors to fit.
      </p>}
    </div>
    <div className="preflop-controls">
      <label>Preset
        <select aria-label="Range preset" value={presetIndex} onChange={event => setPreset(Number(event.target.value))}>
          {presets.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}
        </select>
      </label>
      <label>Spot
        <select aria-label="Spot" value={spotId} onChange={event => setSpot(event.target.value)}>
          {preflopSpotGroups.map(group => <optgroup key={group.label} label={group.label}>
            {group.spots.map(spot => <option key={spot.id} value={spot.id}
              disabled={!preset.ranges.get(spot.id)?.length}>
              {spot.label}{group.label !== 'RFI' && ' · ' + group.label}
            </option>)}
          </optgroup>)}
        </select>
      </label>
    </div>
    <ul className="preflop-legend" aria-label="Position matrix colors">
      {colorLegend.map(({ label, color }) => <li key={label}>
        <span className="preflop-swatch" style={{ backgroundColor: color }} aria-hidden="true" />
        {label}
      </li>)}
    </ul>
  </>
}

export default function PreflopViewer() {
  const [presets, setPresets] = useState<PreflopPreset[] | null>()
  const [attempt, retry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = parsePreflopPresets(await readStudyFile(preflopStudyPath, controller.signal))
        if (!controller.signal.aborted) setPresets(data)
      } catch {
        if (!controller.signal.aborted) setPresets(null)
      }
    }
    void load()
    return () => controller.abort()
  }, [attempt])

  return <div className="preflop-viewer">
    {presets ? <RangeViewer presets={presets} /> : <>
      {presets === undefined ? <p role="status">Loading preflop ranges…</p> : <div className="preflop-load-error">
        <p className="error" role="alert">Couldn’t load the preflop ranges.</p>
        <button type="button" className="button" onClick={() => { setPresets(undefined); retry(count => count + 1) }}>Retry</button>
      </div>}
    </>}
  </div>
}
