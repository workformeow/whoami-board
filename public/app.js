// Confirm before logout / forget, copy buttons, and streamed login output.
const csrf = document.querySelector('meta[name="csrf"]').content

// After a logout or git action the server redirects to /#tool-<id>: keep that row expanded.
if (/^#tool-[a-z]+$/.test(location.hash)) {
  document.querySelector(location.hash)?.setAttribute('open', '')
}

document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    if (!confirm(form.dataset.confirm)) e.preventDefault()
  })
})

document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(btn.dataset.copy)
    btn.textContent = 'คัดลอกแล้ว'
    setTimeout(() => (btn.textContent = 'คัดลอก'), 1500)
  })
})

document.querySelectorAll('[data-login]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.login
    const out = document.querySelector(`[data-output="${id}"]`)
    const links = document.querySelector(`[data-links="${id}"]`)
    const seen = new Set()
    btn.disabled = true
    btn.textContent = 'กำลังรอ login… (ยกเลิกอัตโนมัติใน 5 นาที)'
    out.classList.remove('hidden')
    out.textContent = ''

    const es = new EventSource(`/login/${id}?csrf=${encodeURIComponent(csrf)}`)
    es.addEventListener('out', (e) => {
      const text = JSON.parse(e.data)
      out.textContent += text
      out.scrollTop = out.scrollHeight
      for (const url of text.match(/https?:\/\/[^\s"'<>]+/g) ?? []) {
        if (seen.has(url)) continue
        seen.add(url)
        const a = Object.assign(document.createElement('a'), {
          href: url,
          target: '_blank',
          rel: 'noopener',
          textContent: `🔗 ${url}`,
          className: 'block text-blue-600 underline dark:text-blue-400',
        })
        links.append(a)
      }
    })
    const finish = (msg) => {
      es.close()
      out.textContent += `\n${msg}\nกำลังรีเฟรช…`
      setTimeout(() => location.reload(), 1500)
    }
    es.addEventListener('done', (e) => finish(JSON.parse(e.data)))
    es.onerror = () => finish('การเชื่อมต่อหลุด')
  })
})
