import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Preserve parser coverage against the original snapshots without publishing them in the site build.
const snapshot = 'f9ea705820f13dc1574f29dcb9a0c8773a580f45'
const cwd = fileURLToPath(new URL('..', import.meta.url))

export const readStudySnapshot = path => execFileSync('git', ['show', snapshot + ':public/' + path], {
  cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
})

export const reportSnapshotNames = () => execFileSync('git', ['ls-tree', '-r', '--name-only', snapshot, 'public/flop-reports'], {
  cwd, encoding: 'utf8',
}).trim().split('\n').map(path => path.split('/').at(-1))
