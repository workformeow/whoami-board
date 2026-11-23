export type ToolId =
  | 'vercel'
  | 'netlify'
  | 'wrangler'
  | 'turso'
  | 'firebase'
  | 'flyctl'
  | 'railway'
  | 'heroku'
  | 'gh'
  | 'glab'
  | 'npm'
  | 'eas'
  | 'aws'
  | 'az'
  | 'gcloud'

/** Result of one status check. */
export type Card = {
  id: ToolId
  name: string
  installed: boolean
  ok: boolean
  account: string | null
  detail: string
}

/** Card plus the fixed per-tool info the view needs. */
export type CardView = Card & {
  group: string
  badge: { icon: string; label: string; cls: string; dot: string }
  statusCmd: string
  logoutCmd: string | null
  logoutConfirm: string
  logoutSteps: string[]
  loginCmd: string
  steps: string[]
  canStartLogin: boolean
  loginNote: string
  installHint: string
  envWarnings: string[]
}

export type GitIdentity = { name: string; email: string }

export type SshAccount = {
  host: string
  account: string | null
  note: string
  /** Key file path from ~/.ssh/config (the path only; the file is never read). */
  identityFile: string | null
  /** Command to copy for deleting that key pair; shown only, never run by the page. */
  removeCmd: string | null
}

/** A Windows Credential Manager entry: names only, as `cmdkey /list` prints them. */
export type GithubCredential = { target: string; user: string; deleteCmd: string }

export type GitInfo = {
  installed: boolean
  global: GitIdentity
  repo:
    | (GitIdentity & {
        path: string
        overrides: boolean
        remote: { url: string; via: string } | null
      })
    | null
  repoError: string | null
  helpers: string[]
  helperNote: string
  ghSetupGit: boolean
  /** github.com account names Git Credential Manager knows (names only, never secrets). */
  httpsAccounts: string[]
  httpsNote: string
  /** Which GitHub account each SSH host alias signs in as (`ssh -T`). */
  ssh: SshAccount[]
  /** GitHub entries in Windows Credential Manager, for the "clean up an account" steps. */
  githubCredentials: GithubCredential[]
  /** `ssh` without the plain github.com entry: the extra hosts from ~/.ssh/config. */
  sshAliases: SshAccount[]
  sshConfigEditCmd: string
}

export type Flash = { text: string; cls: string }

export type DashboardView = {
  installed: CardView[]
  missing: CardView[]
  summary: { ok: number; off: number; installed: number; total: number }
  git: GitInfo
  csrf: string
  repo: string
  flash: Flash | null
  checkedAt: string
  refreshUrl: string
}
