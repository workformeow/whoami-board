import { join } from 'node:path'
import express, { type Response } from 'express'
import { checkAll, ghActiveAccount, isTool, toCardView, TOOLS } from './lib/checks.ts'
import { csrfToken, validToken } from './lib/csrf.ts'
import { forgetGithub, gitInfo, setIdentity, validRepo } from './lib/git.ts'
import { clean, kill, run, startLogin, type RunResult } from './lib/run.ts'
import type { DashboardView, Flash, ToolId } from './lib/types.ts'

const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT ?? 4500)
const ALLOWED_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`]
const LOGIN_TIMEOUT_MS = 5 * 60_000

const app = express()
app.set('view engine', 'ejs')
app.set('views', join(import.meta.dirname, 'views'))

// Only this machine, under its own name (also blocks DNS-rebinding pages).
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.includes(req.headers.host ?? '')) return res.status(403).send('Forbidden')
  next()
})
app.use(express.static(join(import.meta.dirname, 'public')))
app.use(express.urlencoded({ extended: false }))
app.use((req, res, next) => {
  if (req.method !== 'POST') return next()
  const origin = req.headers.origin ?? ''
  const sameOrigin = ALLOWED_HOSTS.some((h) => origin === `http://${h}`)
  if (!sameOrigin || !validToken(req.body?._csrf)) return res.status(403).send('Forbidden')
  next()
})

let flash: Flash | null = null
const setFlash = (ok: boolean, text: string) => {
  flash = {
    text,
    cls: ok
      ? 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100'
      : 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100',
  }
}
const field = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const home = (repo: string) => (repo ? `/?repo=${encodeURIComponent(repo)}` : '/')
const back = (res: Response, repo: string, row = 'git') =>
  res.redirect(303, `${home(repo)}#tool-${row}`)
const firstLine = (r: RunResult) =>
  clean(r.stderr || r.stdout)
    .split(/\r?\n/)
    .find((l) => l.trim()) ?? ''

app.get('/', async (req, res) => {
  const repo = field(req.query.repo)
  const [cards, git] = await Promise.all([checkAll(), gitInfo(repo)])
  const views = cards.map(toCardView)
  const installed = views.filter((c) => c.installed)
  const view: DashboardView = {
    installed,
    missing: views.filter((c) => !c.installed),
    summary: {
      ok: installed.filter((c) => c.ok).length,
      off: installed.filter((c) => !c.ok).length,
      installed: installed.length,
      total: views.length,
    },
    git,
    csrf: csrfToken,
    repo,
    flash,
    checkedAt: new Date().toLocaleTimeString('th-TH'),
    refreshUrl: home(repo),
  }
  flash = null
  res.render('index', view)
})

async function logout(tool: ToolId): Promise<RunResult | string> {
  const id = TOOLS[tool].logout
  if (!id) return 'เครื่องมือนี้ไม่มีคำสั่ง logout'
  if (id !== 'gh.logout') return run(id)
  // gh asks which account when several are signed in; the account comes from gh itself.
  const account = await ghActiveAccount()
  return account ? run('gh.logout', account) : 'ไม่พบบัญชี gh ที่ login อยู่'
}

app.post('/logout/:tool', async (req, res) => {
  const tool = req.params.tool
  const repo = field(req.body.repo)
  if (!isTool(tool)) return res.status(404).send('Not found')
  const r = await logout(tool)
  const name = TOOLS[tool].name
  if (typeof r === 'string') setFlash(false, `Logout ${name} ไม่สำเร็จ: ${r}`)
  else if (r.code === 0) setFlash(true, `Logout ${name} แล้ว`)
  else setFlash(false, `Logout ${name} ไม่สำเร็จ: ${r.timedOut ? 'ไม่ตอบ' : firstLine(r)}`)
  back(res, repo, tool)
})

// Login output as Server-Sent Events. EventSource can't POST, so the CSRF token is in the query.
app.get('/login/:tool', (req, res) => {
  const tool = req.params.tool
  const loginId = isTool(tool) ? TOOLS[tool].login : null
  if (!loginId || !validToken(req.query.csrf)) return res.status(403).send('Forbidden')

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  const send = (event: string, data: string) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const child = startLogin(loginId)
  if (!child) {
    send('done', 'ไม่พบคำสั่งนี้ในเครื่อง')
    return res.end()
  }
  const onData = (d: Buffer) => send('out', clean(String(d)))
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  const timer = setTimeout(() => kill(child), LOGIN_TIMEOUT_MS)
  child.on('error', () => send('done', 'เริ่มคำสั่งไม่ได้'))
  child.on('close', (code) => {
    clearTimeout(timer)
    send('done', code === 0 ? 'login เสร็จแล้ว' : `จบด้วย exit ${code ?? 'timeout'}`)
    res.end()
  })
  res.on('close', () => {
    clearTimeout(timer)
    kill(child)
  })
})

app.post('/git/identity', async (req, res) => {
  const name = field(req.body.name)
  const email = field(req.body.email)
  const repo = field(req.body.repo)
  const forRepo = req.body.scope === 'repo'
  if (!name || !email || name.startsWith('-') || !/^[^\s-]\S*@\S+$/.test(email)) {
    setFlash(false, 'ชื่อหรืออีเมลไม่ถูกต้อง')
    return back(res, repo)
  }
  if (forRepo && !validRepo(repo)) {
    setFlash(false, 'ไม่พบโฟลเดอร์ .git ใน path นี้')
    return back(res, repo)
  }
  const ok = await setIdentity(name, email, forRepo ? repo : undefined)
  const where = forRepo ? `repo ${repo}` : 'global'
  setFlash(ok, ok ? `บันทึกชื่อ commit (${where}) แล้ว` : 'บันทึกไม่สำเร็จ')
  back(res, repo)
})

app.post('/git/forget', async (req, res) => {
  const ok = await forgetGithub()
  setFlash(ok, ok ? 'ลืม credentials ของ github.com แล้ว: push ครั้งถัดไปจะถามบัญชีใหม่' : 'ลบไม่สำเร็จ')
  back(res, field(req.body.repo))
})

app.listen(PORT, HOST, () => console.log(`whoami-board: http://${HOST}:${PORT}`))
