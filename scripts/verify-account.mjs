// Run against a local Vite server configured with a disposable Supabase URL.
// Playwright intercepts all backend requests; no live accounts are created.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const origin = process.env.TEST_APP_URL || 'http://127.0.0.1:5178'
const host = new URL(origin).hostname
assert.ok(['localhost', '127.0.0.1'].includes(host), 'Use a local test server')
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(edge) ? edge : undefined),
})

const person = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated',
  email: 'owner@example.test', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {} }
const household = { id: '00000000-0000-4000-8000-000000000002', name: 'QA home',
  invite_code: '012345', monthly_budget: 1500, base_currency: 'SGD', timezone: 'Asia/Singapore' }
const member = { user_id: person.id, household_id: household.id, email: person.email, display_name: 'Owner', joined_at: '2026-01-01T00:00:00Z' }
const session = { access_token: 'fixture-only', refresh_token: 'fixture-refresh-token', token_type: 'bearer', expires_in: 3600, user: person }
const sample = { id: '00000000-0000-4000-8000-000000000003', household_id: household.id,
  name: 'Transport', icon: 'taxi', color: '#267C91', sort_order: 0, archived: false }

async function check(theme) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, colorScheme: theme })
  const page = await context.newPage()
  await page.addInitScript(theme => localStorage.setItem('theme', theme), theme)
  // Keep copied fixture credentials inside the isolated page.
  await page.addInitScript(() => Object.defineProperty(navigator,'clipboard',{value:{
    writeText: async text => { window.fixtureClipboard=text }
  }}))
  let joined = false
  let categories = [sample]
  const rpcCalls = []
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route(/^https:\/\/[^/]+\.supabase\.co\//, async route => {
    const request = route.request()
    const url = new URL(request.url())
    const body = request.postData() ? JSON.parse(request.postData()) : {}
    const end = url.pathname.split('/').at(-1)
    let data
    if (end === 'token' || end === 'signup') data = session
    else if (end === 'get_widget_token') data = 'a'.repeat(64)
    else if (end === 'rotate_widget_token') data = 'b'.repeat(64)
    else if (end === 'user') data = person
    else if (end === 'logout') data = {}
    else if (end === 'members') data = url.searchParams.get('select') === 'household_id' ? (joined ? member : null) : [member]
    else if (end === 'households') data = household
    else if (end === 'check_household_id') { assert.equal(body.p_code,'012345'); data={members:[{id:person.id,name:'Owner'}]} }
    else if (end === 'create_household' || end === 'link_household_device') { joined = true; rpcCalls.push({ end, body }); data = household.id }
    else if (end === 'categories') {
      if (request.method() === 'POST') {
        const category = { ...body, id: crypto.randomUUID(), archived: false }
        categories = [...categories, category]
        data = { id: category.id }
      } else if (request.method() === 'PATCH') {
        const id = url.searchParams.get('id').slice(3)
        categories = categories.map(row => row.id === id ? { ...row, ...body } : row)
        data = { id }
      } else data = categories
    } else if (end === 'reorder_categories') {
      categories = categories.map(row => ({ ...row, sort_order: body.p_ids.indexOf(row.id) }))
      rpcCalls.push({ end, body })
      data = null
    } else if (end === 'month_summary') data = {}
    else data = []
    await route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } })
  })
  // Start on the destination route to exercise the gates without the dashboard.
  await page.goto(origin + '/settings')
  await page.getByRole('heading', { name: 'Enter household ID' }).waitFor()
  if (theme === 'dark') {
    await page.getByLabel('Six-digit household ID').fill('012345')
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await page.getByLabel('Household member').selectOption(person.id)
    await page.getByRole('button',{name:'Open household'}).click()
  } else {
    await page.getByRole('button',{name:'Create a household'}).click()
    await page.getByLabel('Your name').fill('Owner')
    await page.getByLabel('Household name').fill(household.name)
    await page.getByLabel('Monthly budget (SGD)').fill('1500')
    await page.getByRole('button',{name:'Create household',exact:true}).click()
  }
  await page.getByRole('heading',{name:'Settings'}).waitFor()
  await page.reload()
  await page.getByRole('heading',{name:'Settings'}).waitFor()
  assert.equal(rpcCalls.length,1)
  await page.getByRole('button', { name: 'Add category', exact: true }).click()
  await page.getByLabel('Category name').fill('Companion')
  await page.getByPlaceholder('Search icons').fill('cat')
  await page.getByRole('button', { name: 'Cat · pets', exact: true }).click()
  await page.getByRole('button', { name: 'Save category' }).click()
  await page.getByRole('button', { name: 'Companion', exact: true }).waitFor()
  assert.equal(categories[1].icon, 'cat')
  await page.getByRole('button', { name: 'Move Companion up' }).click()
  await page.waitForFunction(() => document.querySelector('.account-cat-name')?.textContent === 'Companion')
  await page.getByRole('button', { name: 'Archive Companion' }).click()
  await page.getByText('Archived categories (1)').click()
  await page.getByRole('button', { name: 'Restore' }).click()
  await page.getByRole('button', { name: 'Companion', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme)
  await page.getByRole('button',{name:'Set up Scriptable'}).click()
  await page.getByRole('button',{name:'Copy widget script'}).click()
  const copied = await page.evaluate(()=>window.fixtureClipboard)
  assert.ok(copied.includes('const WIDGET_TOKEN = "'+'a'.repeat(64)+'"'))
  assert.ok(copied.includes('https://hh-test.supabase.co') && !copied.includes('__SUPABASE_KEY__'))
  await page.getByRole('button',{name:'Rotate token'}).click()
  await page.getByRole('button',{name:'Replace token'}).click()
  await page.getByText('Token replaced.',{exact:false}).waitFor()
  await page.getByRole('button',{name:'Copy token'}).click()
  assert.equal(await page.evaluate(()=>window.fixtureClipboard),'b'.repeat(64))
  assert.deepEqual(errors, [])
  await context.close()
  console.log(`${theme}: sign-in, onboarding, category add/search/reorder/archive/restore and viewport passed`)
}

try {
  await check('light')
  await check('dark')
} finally {
  await browser.close()
}
