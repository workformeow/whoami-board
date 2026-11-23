# AGENTS.md: whoami-board

Guidance for AI assistants (Claude Code in VS Code, or any agent) working in this folder. Read it
before writing code. If the code and this file disagree, the code wins: fix this file in the same
change.

## 1. What this is

A small web page that runs **only on the owner's own computer** and shows, at a glance, which
command-line tools are signed in and as whom, plus the git identity SourceTree commits with.

- It **reads the state of the CLIs**; it never stores or handles tokens or passwords.
- What the page shows must match what an agent in the VS Code terminal can use: both read the same
  CLI config files / OS keychain of the same OS user.
- A personal tool, not part of any other app. No database, no accounts, no cloud.

Out of scope: signing in with an email and password, storing credentials, reading tokens,
managing SourceTree's own account list (SourceTree keeps it inside the app).

Keep it small: a few hundred lines in total. Prefer the simplest code that works over layers,
abstractions and defensive checks for cases that can't happen on one person's computer.

## 2. Stack

- **Node 26.13.1** (Active LTS). `.nvmrc` holds `26.13.1`; `package.json` has
  `"engines": { "node": ">=26.13.1" }` and `"type": "module"`.
- **TypeScript run directly by Node** (type stripping): no build step, no `dist/`.
  - `npm start` → `node server.ts`; `npm run dev` → `node --watch server.ts`.
  - `npm run typecheck` → `tsc --noEmit` (TypeScript is a dev dependency, used only to check).
- **Express 5**, **EJS** views, **Tailwind CSS** from its CDN script (no build; swap for a
  Tailwind CLI file later if the page must work offline).
- Dev dependencies: `typescript`, `@types/node`, `@types/express`, `@types/ejs`, `prettier`.
  Runtime: `express`, `ejs`. Nothing else unless the owner agrees.
- Must run on **Windows and macOS** (and Linux).

### TypeScript rules (what Node can run without a build)

`tsconfig.json`: `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`,
`verbatimModuleSyntax`, `module` / `moduleResolution` `nodenext`, `target` `esnext`.

- Import project files **with the `.ts` extension**: `import { run } from './lib/run.ts'`.
- No `enum`, no `namespace`, no constructor parameter properties (`constructor(private x)`):
  use union types and `as const` objects.
- Type-only imports use `import type`.
- Types matter at one boundary only: what a check returns and what a view receives
  (`lib/types.ts`). Don't add runtime validation libraries.

### Layout

```
whoami-board/
  package.json  tsconfig.json  .nvmrc  .prettierrc
  server.ts           # Express app, routes, listens on 127.0.0.1 only
  .gitignore          # node_modules, logs, .env, OS/editor files
  lib/types.ts        # Card, CardView, GitInfo, DashboardView
  lib/run.ts          # the one place that runs commands: whitelist, spawn, timeout, kill
  lib/checks.ts       # TOOLS (fixed per-tool info), one check per tool → Card, toCardView
  lib/git.ts          # git identity + credential helper
  lib/csrf.ts         # per-process token for every POST form
  views/index.ejs     # summary tiles + list of installed CLIs + "not installed" list
  views/partials/     # row.ejs, detail.ejs, steps.ejs, copy.ejs (command + copy button),
                      # git-form.ejs (Git row), cleanup.ejs (old-account clean-up steps)
  public/app.js       # confirm, copy buttons, re-open row after redirect, login SSE
```

## 3. What the dashboard shows

The page can't discover every login on the machine (each CLI stores it its own way), so `TOOLS`
in `lib/checks.ts` is a registry of known CLIs. The page:

1. **Summary tiles**: signed in / not signed in / CLIs found (`installed / total`) / git name.
2. **List of the CLIs installed on this machine** (plus a Git row): status dot, name, account,
   and a **"ดู"** button that expands the row in place (`<details>`, no modal) with the account,
   how to log out (a Logout button running the fixed command, or steps when the CLI has none),
   how to log in (§4), and the status command to check it yourself.
3. **Not installed** (collapsed): name + install hint.

States: ✅ signed in as `<account>` / ❌ not signed in / ⚪ not installed.

```ts
export type Card = {
  id: ToolId // 'vercel' | 'netlify' | 'wrangler' | … (see lib/types.ts)
  name: string
  installed: boolean
  ok: boolean
  account: string | null
  detail: string
}
```

The view gets `CardView` = `Card` + fixed per-tool info from `TOOLS` (badge, login command,
steps, install hint, env warnings), so the `.ejs` files only print.

| Tool       | Status command (read-only)     | Logout command                              | Login (see §4)                               |
| ---------- | ------------------------------ | ------------------------------------------- | -------------------------------------------- |
| Vercel     | `vercel whoami`                | `vercel logout`                             | `vercel login`                               |
| Turso      | `turso auth whoami`            | `turso auth logout`                         | `turso auth login`                           |
| GitHub CLI | `gh auth status -h github.com` | `gh auth logout -h github.com -u <account>` | `gh auth login -h github.com -p https --web` |
| npm        | `npm whoami`                   | `npm logout`                                | `npm login` (steps only)                     |

Also in the registry (status → logout; login is steps only unless marked ▶ = "Start login"):
Netlify `netlify status` → `netlify logout` ▶; Cloudflare `wrangler whoami` → `wrangler logout` ▶;
Fly.io `flyctl auth whoami` → `flyctl auth logout` ▶; Railway `railway whoami` → `railway logout`;
Heroku `heroku auth:whoami` → `heroku logout`; Firebase `firebase login:list` → `firebase logout`;
GitLab `glab auth status` → `glab auth logout --hostname gitlab.com`; Expo `eas whoami` →
`eas logout`; Azure `az account show --query user.name -o tsv` → `az logout`; Google Cloud
`gcloud auth list --filter=status:ACTIVE --format=value(account)` → `gcloud auth revoke --quiet`;
AWS `aws sts get-caller-identity` → no logout command (steps: `aws sso logout` or remove the
profile). Adding a tool = a `ToolId`, its commands in `run.ts`, and a `TOOLS` entry.

- Exit code 0 = signed in; take the account name from the output (Vercel prints only the
  username; `gh auth status` prints `Logged in to github.com account <name>` plus
  `- Active account: true`, sometimes on stderr; `turso auth whoami` may exit 0 with
  "not logged in").
- `gh auth logout` asks which account when several are signed in, so always pass `-u` with the
  active account read from `gh auth status` on the server (never from the request).
- Not on `PATH` = not installed (`run.ts` looks it up before spawning, because a Windows shell
  can't report `ENOENT`). A timeout (15 s) = "no answer"; the page never hangs.
- Turso CLI on Windows usually lives in WSL, which this page can't see: the install hint says so.
- Optionally show `vercel teams ls` scope, since `whoami` doesn't say which team is active.
- A **Refresh** button re-runs every check; run the checks in parallel (`Promise.all`).

### Git identity (what SourceTree uses)

Two different things; show both and label them clearly:

1. **Commit author**: `git config --global user.name` / `user.email`, and the same for a repo
   folder the owner picks (`git -C <repo> config user.name`; local overrides global). Editable
   with a form: `git config --global user.name <name>` / `user.email <email>` (or `-C <repo>`
   without `--global`).
2. **Push account**: comes from the credential helper (`git config --get credential.helper`:
   `manager` on Windows (Git Credential Manager), `osxkeychain` on macOS) or from SourceTree's own
   Accounts screen. Show which helper is set. Offer "Forget github.com credentials": run
   `git credential reject` with stdin `protocol=https\nhost=github.com\n\n`, so the next push asks
   again. If `gh auth setup-git` is in use, say so (git then uses the `gh` token).
   Also show, by account name only:
   - **HTTPS**: `git credential-manager github list --no-ui` (GCM's github.com accounts). The
     name `Personal Access Token` means a token stored without a user name: say it can't tell
     which account, and suggest "forget" + log in again.
   - **SSH**: `github.com` plus each non-wildcard `Host` in `~/.ssh/config` whose `HostName` is
     `github.com` → `ssh -T -o BatchMode=yes -o ConnectTimeout=5 <host>` → `Hi <account>!`.
     SourceTree set to PuTTY/Pageant isn't covered.
   - For the picked repo: `git -C <repo> remote get-url origin` (user info stripped from HTTPS
     URLs) and which of the above it uses (`HTTPS` → Credential Manager, `git@<host>:` → that
     SSH host's account).
     Say on the page that the commit name/email has nothing to do with access to a repo.

3. **Clean up an old GitHub account (owner does it by hand)**: a collapsed section at the end of
   the Git row. The page **only shows steps and copyable commands; it never deletes anything**
   (no route runs these). Steps: GitHub website (delete SSH key, revoke Sourcetree, delete
   tokens, or ask the org admin) → SourceTree (remove account, delete bookmarks) → Credential
   Manager entries whose target contains `github` (from `cmdkey /list`, names only) with
   `cmdkey /delete:"<target>"` → each SSH host alias with "remove the `Host` block"
   (`notepad "$HOME\.ssh\config"`) and the key-file delete command built from its
   `IdentityFile` path → company repos on disk → Refresh to check. Nothing account-specific is
   hard-coded; everything comes from what the machine has.

## 4. Login: never with a password

The CLIs don't take passwords: they open a browser or show a device code, sometimes with 2FA. **The
page never asks for, receives or forwards an email + password or a token.**

Each login card offers:

1. **Steps to follow** (default): the exact command to run in a terminal (copy button), what will
   happen ("a browser opens, press Authorize"), then "press Refresh".
2. Optional **"Start login"** for logins that just open a browser (`vercel login`,
   `turso auth login`, `gh auth login -h github.com -p https --web`): `spawn` it with stdin
   closed, stream its output to the page with Server-Sent Events (`GET /login/:tool?csrf=…`,
   since `EventSource` can't POST) so a device code or URL can be shown, kill it after 5 minutes
   or when the page closes, then refresh the card. Never write user input to the process's stdin.
3. `npm login` and anything that asks questions in the terminal: steps only.

What works from the page, and why not when it doesn't (the card shows the short reason):

| Tool       | Logout                   | Login from the page                                   |
| ---------- | ------------------------ | ----------------------------------------------------- |
| Vercel     | yes                      | yes (shows URL / code)                                |
| Turso      | yes                      | yes (opens the browser)                               |
| GitHub CLI | yes, with `-u <account>` | yes if `-p https` stops every prompt; else steps only |
| npm        | yes                      | no: waits for Enter and may ask more → steps only     |

Say on the page: signing in on the provider's website (a browser cookie) does **not** sign in the
CLI; only the CLI login gives the token the terminal and the AI agent use. A login made in any
terminal of the same OS user (CMD, PowerShell, Terminal.app, VS Code) is seen by all of them,
except WSL vs Windows, Dev Containers / Remote SSH, another OS user, or an env var overriding it:
warn when `VERCEL_TOKEN`, `TURSO_API_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN` is set (by name only,
never the value).

## 5. Security (the page runs commands on this computer)

Few rules, all required:

- Listen on **`127.0.0.1` only** (never `0.0.0.0`); port from `PORT` or 4500. Reject any
  request whose `Host` isn't `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding).
- `lib/run.ts` is the only module that starts a process. It takes an **id from a fixed map**
  (`'vercel.whoami'`, `'vercel.logout'`, …) to a command + args array. Nothing from a request
  becomes a command, a flag or a shell string; request values only fill an entry's value slots
  (git name/email/repo).
- `spawn` with an args array. On Windows a `.cmd` shim (`vercel.cmd`, `npm.cmd`) runs through the
  shell, and `run.ts` refuses any entry with values there; processes are killed with
  `taskkill /T` so the shim's child dies too.
- Form values passed as arguments (git name, email, repo path): reject an empty value, one
  starting with `-`, or a repo path without a `.git` folder. That's enough.
- Every POST carries the CSRF token from the page; also reject a POST whose `Origin` isn't this
  server's.
- Never read token files, key files or keychains; never print, log or render a token. Show only
  the account line of a CLI's output. The one file read directly is `~/.ssh/config`, for
  `Host` / `HostName` / `IdentityFile` lines only (the key file's path, never its content).
  `cmdkey /list` is allowed (target + user names only). Never use `git credential fill` (it
  returns the secret).
- Logout and "forget credentials" ask for confirmation on the page first.

## 6. UI

- One page, phone-friendly, Tailwind utility classes only; light/dark by `prefers-color-scheme`.
- Thai labels; command names, account names and outputs stay as they are.
- Green = signed in, red = not signed in, grey = not installed. Buttons have text labels.
- Views only loop and print what `res.render` gives them (`DashboardView`); no logic in `.ejs`.

## 7. Conventions

- Prettier: 2 spaces, single quotes, no semicolons, width 100.
- Small functions, early returns, `async` / `await`. No `console.log` except the startup line.
- Code, comments and commit messages in English; reply to the owner in Thai.
- Don't commit or push unless the owner asks; suggest a Conventional Commit message instead.

## 8. Done when

1. `npm run typecheck` passes and `npm start` serves `http://127.0.0.1:4500`.
2. Every card matches running its status command in a terminal on this machine.
3. Logout of one tool from the page → the terminal agrees; login by the steps → Refresh → green.
4. The git form changes `git config --global user.email`, and a new commit in SourceTree shows it.
5. Checked with a missing CLI, a signed-out CLI and a slow one (timeout), on the owner's OS.
6. Another device on the LAN can't open the page.
