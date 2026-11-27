import { readFileSync, writeFileSync } from 'node:fs'

const input = process.argv[2]
if (!input) throw Error('Pass the compiled compact-f64.wasm path')
const bytes = readFileSync(input)
if (!WebAssembly.validate(bytes)) throw Error('Invalid WebAssembly module')
const target = new URL('../../public/turn-river-lab/compiled-traversal.js', import.meta.url)
const source = readFileSync(target, 'utf8')
const marker = /(\/\/ Generated from scripts\/solver\/compact-f64\.wat[^\n]*\n    const source=')[A-Za-z0-9+/=]+(';)/
if (!marker.test(source)) throw Error('Compact kernel marker not found')
writeFileSync(target, source.replace(marker, (_, prefix, suffix) => prefix + bytes.toString('base64') + suffix))
