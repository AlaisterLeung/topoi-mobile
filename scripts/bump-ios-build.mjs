// Increment the iOS build number (CURRENT_PROJECT_VERSION) with Xcode's own agvtool.
// Run it once per upload, right before archiving: the web build never touches the
// build number, so two archives of one bundle can never share a number. The Xcode
// project keeps the value; this only moves it, and it exits non-zero unless every
// target configuration advanced by exactly one. Archive, then read the number back
// off the archived bundle with PlistBuddy print :CFBundleVersion.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const IOS = join(ROOT, 'ios', 'App')
const PBX = join(IOS, 'App.xcodeproj', 'project.pbxproj')
const KEY = 'CURRENT_PROJECT_VERSION'

// One line out, one line in: the whole point of this script is a build log that says what happened, never a stack trace.
const fail = message => {
  console.error(`Failed to bump ios build number: ${message}`)
  process.exit(1)
}

/** The project stores the build number once per target configuration (Debug and Release), and a split value would ship two different build numbers, so read them all and treat disagreement as a failure. */
const readNumbers = () => {
  let project
  try {
    project = readFileSync(PBX, 'utf8')
  } catch (error) {
    fail(`cannot read ${PBX}: ${error.message}`)
  }
  return project
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith(`${KEY} = `))
    .map(line => Number(line.slice(KEY.length + 3).replace(';', '')))
}

const main = () => {
  const before = readNumbers()
  if (before.length === 0) fail(`${PBX} carries no ${KEY}`)
  if (before.some(n => !Number.isInteger(n))) fail(`${KEY} is not an integer: ${before.join(', ')}`)
  if (new Set(before).size !== 1) fail(`the target configurations disagree on ${KEY}: ${before.join(', ')}`)

  try {
    // agvtool narrates what it is doing ("Setting version of project App to: 10.") on stdout, so capture it rather than letting it into the build log.
    execFileSync('xcrun', ['agvtool', '-noscm', 'next-version'], { cwd: IOS, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    fail(error.stderr?.toString().trim() || error.message)
  }

  const after = readNumbers()
  if (after.length !== before.length) fail(`expected ${before.length} ${KEY} entries, found ${after.length}`)
  const stale = after.findIndex((n, i) => n !== before[i] + 1)
  if (stale !== -1) fail(`configuration ${stale + 1} is ${after[stale]}, expected ${before[stale] + 1}`)

  console.log(`Bumped ios build number from ${before[0]} to ${after[0]}.`)
}

try {
  main()
} catch (error) {
  fail(error.message)
}
