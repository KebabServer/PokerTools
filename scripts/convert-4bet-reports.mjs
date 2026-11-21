import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseFlopReport } from '../src/flopReport.ts'
import { flopReportGroups } from '../src/flopReportCatalog.ts'

const positionAliases = { BTN: 'BU', HJ: 'MP' }
const positionId = position => (positionAliases[position] ?? position).toLowerCase()

function actionColumn({ code, display_name: name, betsize_by_pot: ratio }) {
  if (name === 'CHECK') return { code, label: 'Check' }
  if (name === 'ALLIN') return { code, label: 'AI' }
  const percent = Math.round(Number(ratio) * 100)
  if (name === 'BET' && Number.isFinite(percent) && percent > 0) return { code, label: 'B' + percent }
  throw new Error('Unexpected action at the C-bet decision: ' + code)
}

function boardRow(board, columns, oopPosition, ipPosition) {
  const { name, action_solutions: actions, player_solutions: players } = board
  const oop = players.find(player => player.position === oopPosition)
  const ip = players.find(player => player.position === ipPosition)
  if (!oop || !ip || players.length !== 2) throw new Error('Unexpected players on ' + name)

  const metrics = [oop.ev, oop.eq, ip.ev, ip.eq, oop.eqr, ip.eqr]
  if (!metrics.every(value => value === null || Number.isFinite(value))) throw new Error('Invalid player metrics on ' + name)

  const frequencyByCode = new Map(actions.map(action => [action.action_code, action.frequency]))
  const frequencies = columns.map(({ code }) => frequencyByCode.get(code))
  if (actions.length !== columns.length || !frequencies.every(Number.isFinite)) {
    throw new Error('Unexpected actions on ' + name)
  }

  return [...metrics, ...columns.flatMap(({ code }, index) => [code, frequencies[index]]), name].join(',')
}

export function convertFourBetReport(source) {
  const { status, players, solutions, game_point: node } = source
  if (status !== 'done' || node?.game?.current_street?.type !== 'FLOP') throw new Error('Expected a completed flop report')

  const ip = players.find(player => player.relative_position === 'IP')?.position
  const oop = players.find(player => player.relative_position === 'OOP')?.position
  const actor = node.game.active_position
  if (!ip || !oop || ip === oop || players.length !== 2 || (actor !== ip && actor !== oop)) {
    throw new Error('Could not identify the acting player and both positions')
  }
  const inPosition = actor === ip
  const groupId = inPosition ? '4bet-ip' : '4bet-oop'
  const matchupId = positionId(actor) + '-' + positionId(inPosition ? oop : ip)
  const group = flopReportGroups.find(item => item.id === groupId)
  if (!group.matchups.some(matchup => matchup.id === matchupId)) throw new Error('Unrecognized 4-bet matchup: ' + matchupId)

  const columns = node.available_actions.map(({ action }) => actionColumn(action))
  for (const field of ['code', 'label']) {
    if (new Set(columns.map(column => column[field])).size !== columns.length) throw new Error('Duplicate action ' + field)
  }
  const header = ['oop_ev', 'oop_eq', 'ip_ev', 'ip_eq', 'oop_eqr', 'ip_eqr',
    ...columns.flatMap(({ label }, index) => [`actions/${index}/action_code`, label]), 'flop']
  const rows = solutions.map(board => boardRow(board, columns, oop, ip))
  const csv = [header.join(','), ...rows, ''].join('\n')
  const { boardCount } = parseFlopReport(csv)
  if (new Set(solutions.map(board => board.name.toLowerCase())).size !== boardCount) throw new Error('Duplicate flop')
  return { file: `${groupId}-${matchupId}-cbet.csv`, csv, boardCount }
}

const sqlString = value => "'" + value.replaceAll("'", "''") + "'"

async function convertDirectory(inputDir, outputDir) {
  const reports = new Map()
  const entries = await readdir(inputDir, { withFileTypes: true })
  for (const { name } of entries.filter(entry => entry.isFile() && /\.(txt|json)$/i.test(entry.name))) {
    try {
      const report = convertFourBetReport(JSON.parse(await readFile(join(inputDir, name), 'utf8')))
      if (reports.has(report.file)) throw new Error('More than one export for ' + report.file)
      reports.set(report.file, report)
    } catch (error) {
      throw new Error(name + ': ' + error.message, { cause: error })
    }
  }
  if (!reports.size) throw new Error('No .txt or .json reports found in ' + inputDir)

  const csvDir = join(outputDir, 'flop-reports')
  await mkdir(csvDir, { recursive: true })
  const values = []
  for (const { file, csv } of reports.values()) {
    await writeFile(join(csvDir, file), csv)
    values.push(`(${sqlString('flop-reports/' + file)}, ${sqlString(csv)})`)
  }
  const sql = `insert into public.study_files (path, contents) values
${values.join(',\n')}
on conflict (path) do update set contents = excluded.contents
where study_files.contents is distinct from excluded.contents;
`
  await writeFile(join(outputDir, 'import-4bet-reports.sql'), sql)
  console.log(`Converted ${reports.size} reports into ${csvDir}`)
}

if (import.meta.main) {
  const [inputDir, outputDir] = process.argv.slice(2)
  if (!inputDir || !outputDir) throw new Error('Usage: node scripts/convert-4bet-reports.mjs <export-folder> <output-folder>')
  await convertDirectory(inputDir, outputDir)
}
