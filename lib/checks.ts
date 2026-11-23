import {
  clean,
  commandLine,
  run,
  type CommandId,
  type LoginId,
  type LogoutId,
  type RunResult,
} from './run.ts'
import type { Card, CardView, ToolId } from './types.ts'

const isWin = process.platform === 'win32'
const pick = (win: string, other: string) => (isWin ? win : other)

type Tool = {
  name: string
  group: string
  status: CommandId
  /** Account name from the output (colours removed), or null when signed out. */
  account: (out: string, r: RunResult) => string | null
  logout: LogoutId | null
  /** Shown instead of a Logout button when the CLI has no logout command. */
  logoutSteps?: string[]
  login: LoginId | null
  loginCmd: string
  steps: string[]
  loginNote?: string
  installHint: string
  envVars: string[]
}

const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
const lastLine = (_out: string, r: RunResult) => lines(clean(r.stdout)).at(-1) ?? null
const match = (re: RegExp, not?: RegExp) => (out: string) =>
  not?.test(out) ? null : (out.match(re)?.[1] ?? null)

const BROWSER = 'เบราว์เซอร์จะเปิดขึ้นมา → login และกดยืนยัน'
const REFRESH = 'กลับมากด รีเฟรช'
const IN_TERMINAL = 'ต้องทำใน terminal เอง: คำสั่งนี้ถามคำถามหรือรอให้กด Enter ซึ่งหน้านี้ตอบแทนไม่ได้'

export const TOOLS: Record<ToolId, Tool> = {
  vercel: {
    name: 'Vercel',
    group: 'Hosting',
    status: 'vercel.status',
    account: lastLine,
    logout: 'vercel.logout',
    login: 'vercel.login',
    loginCmd: 'vercel login',
    steps: ['รันคำสั่งนี้ใน terminal', `${BROWSER} (ถ้ามี code ให้ใส่ code ที่แสดง)`, REFRESH],
    installHint: 'npm i -g vercel',
    envVars: ['VERCEL_TOKEN'],
  },
  netlify: {
    name: 'Netlify',
    group: 'Hosting',
    status: 'netlify.status',
    account: match(/Email:\s*(\S+@\S+)/, /not logged in/i),
    logout: 'netlify.logout',
    login: 'netlify.login',
    loginCmd: 'netlify login',
    steps: ['รันคำสั่งนี้ใน terminal', BROWSER, REFRESH],
    installHint: 'npm i -g netlify-cli',
    envVars: ['NETLIFY_AUTH_TOKEN'],
  },
  wrangler: {
    name: 'Cloudflare (wrangler)',
    group: 'Hosting',
    status: 'wrangler.status',
    account: match(/email\s+(\S+@[^\s!]+?)[.!]?(?:\s|$)/, /not authenticated|not logged in/i),
    logout: 'wrangler.logout',
    login: 'wrangler.login',
    loginCmd: 'wrangler login',
    steps: ['รันคำสั่งนี้ใน terminal', `${BROWSER} (กด Allow)`, REFRESH],
    installHint: 'npm i -g wrangler',
    envVars: ['CLOUDFLARE_API_TOKEN'],
  },
  flyctl: {
    name: 'Fly.io',
    group: 'Hosting',
    status: 'flyctl.status',
    account: lastLine,
    logout: 'flyctl.logout',
    login: 'flyctl.login',
    loginCmd: 'flyctl auth login',
    steps: ['รันคำสั่งนี้ใน terminal', BROWSER, REFRESH],
    installHint: pick(
      'pwsh -c "iwr https://fly.io/install.ps1 -useb | iex"',
      'brew install flyctl',
    ),
    envVars: ['FLY_API_TOKEN'],
  },
  railway: {
    name: 'Railway',
    group: 'Hosting',
    status: 'railway.status',
    account: match(/Logged in as (.+)/),
    logout: 'railway.logout',
    login: null,
    loginCmd: 'railway login',
    steps: ['รันคำสั่งนี้ใน terminal', 'ตอบ Y เพื่อเปิดเบราว์เซอร์ → login', REFRESH],
    loginNote: IN_TERMINAL,
    installHint: 'npm i -g @railway/cli',
    envVars: ['RAILWAY_TOKEN', 'RAILWAY_API_TOKEN'],
  },
  heroku: {
    name: 'Heroku',
    group: 'Hosting',
    status: 'heroku.status',
    account: lastLine,
    logout: 'heroku.logout',
    login: null,
    loginCmd: 'heroku login',
    steps: ['รันคำสั่งนี้ใน terminal', 'กดปุ่มใดก็ได้ → เบราว์เซอร์เปิด → login', REFRESH],
    loginNote: IN_TERMINAL,
    installHint: 'npm i -g heroku',
    envVars: ['HEROKU_API_KEY'],
  },
  turso: {
    name: 'Turso',
    group: 'Database',
    status: 'turso.status',
    account: (out, r) =>
      /not logged in/i.test(out)
        ? null
        : (lastLine(out, r)?.replace(/^you are logged in as\s*/i, '') ?? null),
    logout: 'turso.logout',
    login: 'turso.login',
    loginCmd: 'turso auth login',
    steps: ['รันคำสั่งนี้ใน terminal', BROWSER, REFRESH],
    installHint: pick(
      'Windows: Turso CLI มักติดตั้งใน WSL ซึ่งหน้านี้มองไม่เห็น (docs.turso.tech/cli/installation)',
      'brew install tursodatabase/tap/turso',
    ),
    envVars: ['TURSO_API_TOKEN'],
  },
  firebase: {
    name: 'Firebase',
    group: 'Database',
    status: 'firebase.status',
    account: match(/Logged in as (\S+)/),
    logout: 'firebase.logout',
    login: null,
    loginCmd: 'firebase login',
    steps: ['รันคำสั่งนี้ใน terminal', 'ตอบคำถามเรื่องเก็บข้อมูลการใช้งาน → เบราว์เซอร์เปิด → login', REFRESH],
    loginNote: IN_TERMINAL,
    installHint: 'npm i -g firebase-tools',
    envVars: ['FIREBASE_TOKEN'],
  },
  gh: {
    name: 'GitHub CLI',
    group: 'Git hosting',
    status: 'gh.status',
    account: (out) => ghAccounts(out)[0] ?? null,
    logout: 'gh.logout',
    login: 'gh.login',
    loginCmd: 'gh auth login -h github.com -p https --web',
    steps: [
      'รันคำสั่งนี้ใน terminal',
      'copy code ที่แสดง → เปิด github.com/login/device → วาง code แล้วกด Authorize',
      REFRESH,
    ],
    installHint: pick('winget install --id GitHub.cli', 'brew install gh'),
    envVars: ['GH_TOKEN', 'GITHUB_TOKEN'],
  },
  glab: {
    name: 'GitLab CLI',
    group: 'Git hosting',
    status: 'glab.status',
    account: (out) => {
      const m = out.match(/Logged in to (\S+) as (\S+)/)
      return m ? `${m[2]} (${m[1]})` : null
    },
    logout: 'glab.logout',
    login: null,
    loginCmd: 'glab auth login',
    steps: ['รันคำสั่งนี้ใน terminal', 'เลือก gitlab.com → เลือก login ด้วยเบราว์เซอร์', REFRESH],
    loginNote: IN_TERMINAL,
    installHint: pick('winget install --id GLab.GLab', 'brew install glab'),
    envVars: ['GITLAB_TOKEN'],
  },
  npm: {
    name: 'npm',
    group: 'Packages',
    status: 'npm.status',
    account: lastLine,
    logout: 'npm.logout',
    login: null,
    loginCmd: 'npm login',
    steps: [
      'รันคำสั่งนี้ใน terminal',
      'กด Enter → เบราว์เซอร์เปิดหน้า npmjs.com → login (อาจมี 2FA)',
      REFRESH,
    ],
    loginNote: IN_TERMINAL,
    installHint: 'มากับ Node.js',
    envVars: [],
  },
  eas: {
    name: 'Expo (EAS)',
    group: 'Packages',
    status: 'eas.status',
    account: (out, r) => (/not logged in/i.test(out) ? null : lastLine(out, r)),
    logout: 'eas.logout',
    login: null,
    loginCmd: 'eas login',
    steps: [
      'รันคำสั่งนี้ใน terminal',
      'เลือก login ด้วยเบราว์เซอร์ (อย่าพิมพ์รหัสผ่านที่อื่นนอกจาก terminal)',
      REFRESH,
    ],
    loginNote: IN_TERMINAL,
    installHint: 'npm i -g eas-cli',
    envVars: ['EXPO_TOKEN'],
  },
  aws: {
    name: 'AWS CLI',
    group: 'Cloud',
    status: 'aws.status',
    account: (_out, r) => {
      try {
        const { Arn, Account } = JSON.parse(r.stdout) as { Arn: string; Account: string }
        return `${Arn.split(':').at(-1)} (${Account})`
      } catch {
        return null
      }
    },
    logout: null,
    logoutSteps: [
      'AWS CLI ไม่มีคำสั่ง logout แบบทั่วไป',
      'ถ้าใช้ SSO: รัน aws sso logout',
      'ถ้าใช้ access key: ลบ profile ในไฟล์ ~/.aws/credentials',
    ],
    login: null,
    loginCmd: 'aws configure sso',
    steps: [
      'รันคำสั่งนี้ใน terminal (หรือ aws sso login ถ้าตั้งไว้แล้ว)',
      'ตอบคำถาม → เบราว์เซอร์เปิด → กดยืนยัน',
      REFRESH,
    ],
    loginNote: IN_TERMINAL,
    installHint: pick('winget install --id Amazon.AWSCLI', 'brew install awscli'),
    envVars: ['AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN'],
  },
  az: {
    name: 'Azure CLI',
    group: 'Cloud',
    status: 'az.status',
    account: lastLine,
    logout: 'az.logout',
    login: null,
    loginCmd: 'az login',
    steps: ['รันคำสั่งนี้ใน terminal', `${BROWSER} → เลือก subscription ใน terminal`, REFRESH],
    loginNote: IN_TERMINAL,
    installHint: pick('winget install --id Microsoft.AzureCLI', 'brew install azure-cli'),
    envVars: [],
  },
  gcloud: {
    name: 'Google Cloud',
    group: 'Cloud',
    status: 'gcloud.status',
    account: lastLine,
    logout: 'gcloud.logout',
    login: null,
    loginCmd: 'gcloud auth login',
    steps: ['รันคำสั่งนี้ใน terminal', BROWSER, REFRESH],
    loginNote: IN_TERMINAL,
    installHint: 'cloud.google.com/sdk/docs/install',
    envVars: [],
  },
}

export const TOOL_IDS = Object.keys(TOOLS) as ToolId[]
export const isTool = (v: string): v is ToolId => (TOOL_IDS as string[]).includes(v)

/** github.com accounts from `gh auth status`; the active one first. */
function ghAccounts(out: string): string[] {
  const found = [
    ...out.matchAll(/Logged in to github\.com account (\S+)[^\n]*\n\s*- Active account: (\w+)/g),
  ]
  return found.sort((a, b) => Number(b[2] === 'true') - Number(a[2] === 'true')).map((m) => m[1])
}

export async function ghActiveAccount(): Promise<string | null> {
  const r = await run('gh.status')
  return ghAccounts(clean(r.stdout + '\n' + r.stderr))[0] ?? null
}

async function check(id: ToolId): Promise<Card> {
  const tool = TOOLS[id]
  const [r, extra] = await Promise.all([
    run(tool.status),
    id === 'vercel' ? run('vercel.teams') : null,
  ])
  const base = { id, name: tool.name, account: null }
  if (r.missing) return { ...base, installed: false, ok: false, detail: 'ไม่พบคำสั่งนี้ในเครื่อง' }
  if (r.timedOut) return { ...base, installed: true, ok: false, detail: 'ไม่ตอบภายใน 15 วินาที' }

  const out = clean(r.stdout + '\n' + r.stderr)
  const account = r.code === 0 ? tool.account(out, r) : null
  if (!account) return { ...base, installed: true, ok: false, detail: 'ยังไม่ได้ login' }
  return { ...base, installed: true, ok: true, account, detail: detailFor(id, out, extra) }
}

function detailFor(id: ToolId, out: string, extra: RunResult | null): string {
  if (id === 'vercel' && extra) {
    const current = lines(clean(extra.stdout)).find((l) => l.startsWith('✔'))
    const scope = current?.slice(1).trim().split(/\s+/)[0]
    return scope ? `scope ที่ใช้อยู่: ${scope}` : ''
  }
  if (id === 'gh') {
    const others = ghAccounts(out).slice(1)
    return others.length ? `บัญชีอื่นในเครื่อง: ${others.join(', ')}` : ''
  }
  return ''
}

export function checkAll(): Promise<Card[]> {
  return Promise.all(TOOL_IDS.map(check))
}

const BADGES = {
  ok: {
    icon: '✅',
    label: 'login อยู่',
    cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    dot: 'bg-green-500',
  },
  off: {
    icon: '❌',
    label: 'ยังไม่ login',
    cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
    dot: 'bg-red-500',
  },
  missing: {
    icon: '⚪',
    label: 'ไม่ได้ติดตั้ง',
    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400',
  },
}

export function toCardView(card: Card): CardView {
  const tool = TOOLS[card.id]
  const logoutCmd = !tool.logout
    ? null
    : tool.logout === 'gh.logout'
      ? commandLine('gh.logout', card.account ?? 'ACCOUNT')
      : commandLine(tool.logout)
  return {
    ...card,
    group: tool.group,
    badge: !card.installed ? BADGES.missing : card.ok ? BADGES.ok : BADGES.off,
    statusCmd: commandLine(tool.status),
    logoutCmd,
    logoutConfirm: `Logout ${tool.name}${card.account ? ` (${card.account})` : ''} ใช่ไหม?`,
    logoutSteps: tool.logoutSteps ?? [],
    loginCmd: tool.loginCmd,
    steps: tool.steps,
    canStartLogin: tool.login !== null,
    loginNote: tool.loginNote ?? '',
    installHint: tool.installHint,
    envWarnings: tool.envVars
      .filter((name) => process.env[name])
      .map((name) => `ตั้ง ${name} ไว้: CLI จะใช้ค่านี้แทน แม้ logout แล้วก็ยังใช้งานได้`),
  }
}
