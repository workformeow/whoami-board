import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { run, type RunResult } from './run.ts'
import type { GitInfo, GithubCredential, SshAccount } from './types.ts'

const value = (r: RunResult | null) => (r?.code === 0 ? r.stdout.trim() : '')
const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

export function validRepo(path: string): boolean {
  return path.trim() !== '' && !path.startsWith('-') && existsSync(join(path, '.git'))
}

function helperNote(helpers: string[]): string {
  const h = helpers.join(' ')
  if (/manager/.test(h)) return 'Git Credential Manager: บัญชี HTTPS เก็บใน Windows Credential Manager'
  if (/osxkeychain/.test(h)) return 'macOS Keychain: บัญชี HTTPS เก็บใน Keychain Access'
  if (helpers.length === 0) return 'ไม่ได้ตั้ง helper: git จะถามรหัสทุกครั้ง หรือใช้บัญชีจาก SourceTree'
  return ''
}

type SshHost = { host: string; identityFile: string | null }

/**
 * `github.com` plus every non-wildcard Host in ~/.ssh/config whose HostName is github.com,
 * with its IdentityFile path. Only Host / HostName / IdentityFile lines are read.
 */
function githubSshHosts(): SshHost[] {
  const blocks: { hosts: string[]; github: boolean; identityFile: string | null }[] = []
  try {
    for (const line of lines(readFileSync(join(homedir(), '.ssh', 'config'), 'utf8'))) {
      const [key, ...rest] = line.split(/\s+/)
      const block = blocks.at(-1)
      if (/^host$/i.test(key)) blocks.push({ hosts: rest, github: false, identityFile: null })
      else if (block && /^hostname$/i.test(key))
        block.github = rest[0]?.toLowerCase() === 'github.com'
      else if (block && /^identityfile$/i.test(key)) block.identityFile = rest.join(' ')
    }
  } catch {
    // no ~/.ssh/config
  }
  const aliases = blocks
    .filter((b) => b.github)
    .flatMap((b) => b.hosts.map((host) => ({ host, identityFile: b.identityFile })))
    .filter((h) => /^[\w.-]+$/.test(h.host) && h.host !== 'github.com')
  return [{ host: 'github.com', identityFile: null }, ...aliases]
}

/** Command the owner can copy to delete a key pair (shown only; the page never runs it). */
function removeKeyCmd(identityFile: string): string {
  const file = identityFile.replace(/^"|"$/g, '')
  if (process.platform !== 'win32') return `rm "${file}" "${file}.pub"`
  const win = file.replace(/^~/, '$HOME').replace(/\//g, '\\')
  return `Remove-Item "${win}", "${win}.pub"`
}

async function sshAccount({ host, identityFile }: SshHost): Promise<SshAccount> {
  const r = await run('ssh.whoami', host)
  const account = (r.stdout + r.stderr).match(/Hi ([\w-]+)!/)?.[1] ?? null
  const note = r.missing ? 'ไม่พบคำสั่ง ssh' : account ? '' : 'ไม่มี key ที่ GitHub รับ'
  return {
    host,
    account,
    note,
    identityFile,
    removeCmd: identityFile ? removeKeyCmd(identityFile) : null,
  }
}

/** GitHub-related entries in Windows Credential Manager: target + user name (never secrets). */
async function githubCredentials(): Promise<GithubCredential[]> {
  if (process.platform !== 'win32') return []
  const r = await run('win.credList')
  const found: GithubCredential[] = []
  let target = ''
  for (const line of lines(value(r))) {
    const t = line.match(/^Target:\s*(?:\w+:target=)?(.+)$/)
    if (t) target = t[1]
    const u = line.match(/^User:\s*(.+)$/)
    if (u && /github/i.test(target)) {
      found.push({ target, user: u[1], deleteCmd: `cmdkey /delete:"${target}"` })
    }
  }
  return found
}

/** How a remote URL authenticates. User info in an HTTPS URL is never shown. */
function describeRemote(url: string, ssh: SshAccount[]): { url: string; via: string } {
  if (/^https?:\/\//.test(url)) {
    return {
      url: url.replace(/\/\/[^/@]+@/, '//'),
      via: 'HTTPS → ใช้บัญชีใน Credential Manager',
    }
  }
  const host = url.match(/^(?:ssh:\/\/)?[^@/]+@([^:/]+)/)?.[1]
  const match = ssh.find((s) => s.host === host)
  if (!host) return { url, via: '' }
  return { url, via: `SSH ผ่าน ${host} → ${match?.account ?? 'ไม่รู้บัญชี'}` }
}

export async function gitInfo(repo: string): Promise<GitInfo> {
  const repoPath = validRepo(repo) ? repo : undefined
  const [gName, gEmail, rName, rEmail, rRemote, helper, ghHelper, gcm, ssh, creds] =
    await Promise.all([
      run('git.name'),
      run('git.email'),
      repoPath ? run('git.name', repoPath) : null,
      repoPath ? run('git.email', repoPath) : null,
      repoPath ? run('git.remote', repoPath) : null,
      run('git.helper'),
      run('git.githubHelper'),
      run('git.gcmAccounts'),
      Promise.all(githubSshHosts().map(sshAccount)),
      githubCredentials(),
    ])
  const global = { name: value(gName), email: value(gEmail) }
  const helpers = lines(value(helper))
  const ghHelpers = value(ghHelper)
  const httpsAccounts = lines(value(gcm))
  const remote = value(rRemote)

  return {
    installed: !gName.missing,
    global,
    repo: repoPath
      ? {
          path: repoPath,
          name: value(rName),
          email: value(rEmail),
          overrides: value(rName) !== global.name || value(rEmail) !== global.email,
          remote: remote ? describeRemote(remote, ssh) : null,
        }
      : null,
    repoError: repo && !repoPath ? 'ไม่พบโฟลเดอร์ .git ใน path นี้' : null,
    helpers: [...helpers, ...(ghHelpers ? [`github.com: ${lines(ghHelpers).join(', ')}`] : [])],
    helperNote: helperNote(helpers),
    ghSetupGit: /gh(\.exe)?["']? auth git-credential/.test(ghHelpers + helpers.join(' ')),
    httpsAccounts,
    httpsNote:
      gcm.code !== 0
        ? 'ดูรายชื่อบัญชีไม่ได้ (ต้องใช้ Git Credential Manager)'
        : httpsAccounts.length === 0
          ? 'ยังไม่มีบัญชี github.com: push แบบ HTTPS ครั้งถัดไปจะถามให้ login'
          : httpsAccounts.includes('Personal Access Token')
            ? '"Personal Access Token" = เก็บเป็น token โดยไม่มีชื่อบัญชี จึงไม่รู้ว่าเป็นบัญชีไหน ถ้าไม่แน่ใจ ให้กด "ลืม credentials" แล้ว login ใหม่ด้วยบัญชีที่ต้องการ'
            : '',
    ssh,
    githubCredentials: creds,
    sshAliases: ssh.filter((s) => s.host !== 'github.com'),
    sshConfigEditCmd:
      process.platform === 'win32' ? 'notepad "$HOME\\.ssh\\config"' : 'open -e ~/.ssh/config',
  }
}

/** Sets user.name and user.email globally, or for one repo when `repo` is given. */
export async function setIdentity(name: string, email: string, repo?: string): Promise<boolean> {
  const a = await run('git.setName', name, repo)
  if (a.code !== 0) return false
  const b = await run('git.setEmail', email, repo)
  return b.code === 0
}

export async function forgetGithub(): Promise<boolean> {
  return (await run('git.forgetGithub')).code === 0
}
