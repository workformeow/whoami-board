// The only module that starts a process. Commands come from the fixed map below;
// request data can only fill the value slots of an entry and is checked first.
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const isWin = process.platform === 'win32'
const TIMEOUT_MS = 15_000

type Entry = { cmd: string; args: string[]; input?: string }

/** A command with no values, written as one line (args never contain spaces). */
const fixed = (line: string) => (): Entry => {
  const [cmd, ...args] = line.split(' ')
  return { cmd, args }
}

const gitConfig = (repo: string | undefined, ...args: string[]): Entry => ({
  cmd: 'git',
  args: repo ? ['-C', repo, 'config', ...args] : ['config', '--global', ...args],
})

const COMMANDS = {
  'vercel.status': fixed('vercel whoami'),
  'vercel.teams': fixed('vercel teams ls'),
  'vercel.login': fixed('vercel login'),
  'vercel.logout': fixed('vercel logout'),
  'turso.status': fixed('turso auth whoami'),
  'turso.login': fixed('turso auth login'),
  'turso.logout': fixed('turso auth logout'),
  'gh.status': fixed('gh auth status -h github.com'),
  'gh.login': fixed('gh auth login -h github.com -p https --web'),
  'gh.logout': (user: string) => ({
    cmd: 'gh',
    args: ['auth', 'logout', '-h', 'github.com', '-u', user],
  }),
  'glab.status': fixed('glab auth status'),
  'glab.logout': fixed('glab auth logout --hostname gitlab.com'),
  'npm.status': fixed('npm whoami'),
  'npm.logout': fixed('npm logout'),
  'netlify.status': fixed('netlify status'),
  'netlify.login': fixed('netlify login'),
  'netlify.logout': fixed('netlify logout'),
  'wrangler.status': fixed('wrangler whoami'),
  'wrangler.login': fixed('wrangler login'),
  'wrangler.logout': fixed('wrangler logout'),
  'firebase.status': fixed('firebase login:list'),
  'firebase.logout': fixed('firebase logout'),
  'flyctl.status': fixed('flyctl auth whoami'),
  'flyctl.login': fixed('flyctl auth login'),
  'flyctl.logout': fixed('flyctl auth logout'),
  'railway.status': fixed('railway whoami'),
  'railway.logout': fixed('railway logout'),
  'heroku.status': fixed('heroku auth:whoami'),
  'heroku.logout': fixed('heroku logout'),
  'eas.status': fixed('eas whoami'),
  'eas.logout': fixed('eas logout'),
  'aws.status': fixed('aws sts get-caller-identity --output json'),
  'az.status': fixed('az account show --query user.name -o tsv'),
  'az.logout': fixed('az logout'),
  'gcloud.status': fixed('gcloud auth list --filter=status:ACTIVE --format=value(account)'),
  'gcloud.logout': fixed('gcloud auth revoke --quiet'),
  'git.name': (repo?: string) => gitConfig(repo, 'user.name'),
  'git.email': (repo?: string) => gitConfig(repo, 'user.email'),
  'git.setName': (value: string, repo?: string) => gitConfig(repo, 'user.name', value),
  'git.setEmail': (value: string, repo?: string) => gitConfig(repo, 'user.email', value),
  'git.remote': (repo: string) => ({
    cmd: 'git',
    args: ['-C', repo, 'remote', 'get-url', 'origin'],
  }),
  'git.gcmAccounts': fixed('git credential-manager github list --no-ui'),
  // BatchMode: never prompt (passphrase / unknown host key) – just fail.
  'ssh.whoami': (host: string) => ({
    cmd: 'ssh',
    args: ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host],
  }),
  // Lists target + user names only; cmdkey never prints secrets.
  'win.credList': fixed('cmdkey /list'),
  'git.helper': fixed('git config --get-all credential.helper'),
  'git.githubHelper': fixed('git config --get-all credential.https://github.com.helper'),
  'git.forgetGithub': () => ({
    cmd: 'git',
    args: ['credential', 'reject'],
    input: 'protocol=https\nhost=github.com\n\n',
  }),
} satisfies Record<string, (...values: string[]) => Entry>

export type CommandId = keyof typeof COMMANDS
export type LoginId = Extract<CommandId, `${string}.login`>
export type LogoutId = Extract<CommandId, `${string}.logout`>
export type RunResult = {
  code: number | null
  stdout: string
  stderr: string
  missing: boolean
  timedOut: boolean
}
type Values<K extends CommandId> = Parameters<(typeof COMMANDS)[K]>

function entry(id: CommandId, values: (string | undefined)[]): Entry {
  for (const v of values) {
    if (v !== undefined && (v.trim() === '' || v.startsWith('-'))) {
      throw new Error(`Rejected value for ${id}`)
    }
  }
  return (COMMANDS[id] as (...v: (string | undefined)[]) => Entry)(...values)
}

/** The command as text, to show on the page (never run from this string). */
export function commandLine<K extends CommandId>(id: K, ...values: Values<K>): string {
  const e = entry(id, values)
  return [e.cmd, ...e.args].join(' ')
}

/** Full path of a command on PATH, or null when it isn't installed. */
function which(cmd: string): string | null {
  const exts = isWin ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      const file = join(dir.replace(/"/g, ''), cmd + ext.toLowerCase())
      if (dir && existsSync(file)) return file
    }
  }
  return null
}

function start(id: CommandId, values: (string | undefined)[]): ChildProcess | null {
  const e = entry(id, values)
  const file = which(e.cmd)
  if (!file) return null

  const stdio: StdioOptions = [e.input ? 'pipe' : 'ignore', 'pipe', 'pipe']
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  // Windows .cmd shims (vercel.cmd, npm.cmd) need cmd.exe. Only fixed args go through it.
  const shim = isWin && /\.(cmd|bat)$/i.test(file)
  if (shim && values.length > 0) throw new Error(`${id} cannot take values through a shell`)
  const child = shim
    ? spawn([e.cmd, ...e.args].join(' '), { shell: true, stdio, env, windowsHide: true })
    : spawn(file, e.args, { stdio, env, windowsHide: true })

  if (e.input) child.stdin?.end(e.input)
  return child
}

/** Kill a process and its children (cmd.exe shims spawn a child on Windows). */
export function kill(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  else child.kill()
}

export function run<K extends CommandId>(id: K, ...values: Values<K>): Promise<RunResult> {
  const child = start(id, values)
  const missing = { code: null, stdout: '', stderr: '', missing: true, timedOut: false }
  if (!child) return Promise.resolve(missing)

  return new Promise((done) => {
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => {
      kill(child)
      done({ code: null, stdout, stderr, missing: false, timedOut: true })
    }, TIMEOUT_MS)
    child.on('error', () => {
      clearTimeout(timer)
      done(missing)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr, missing: false, timedOut: false })
    })
  })
}

/** Long-running login process whose output is streamed to the page. Never written to. */
export function startLogin(id: LoginId): ChildProcess | null {
  return start(id, [])
}

/** Remove colour codes and anything that looks like a token. */
export function clean(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\b(gh[opusr]_|github_pat_|glpat-|npm_)[A-Za-z0-9_-]+/g, '$1***')
}
