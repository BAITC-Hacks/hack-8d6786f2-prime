import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.skip(process.env.QA_DATABASE_ISOLATED !== '1', 'Run only using qa/run_platform_e2e.py with a disposable database')

const token = process.env.QA_ADMIN_TOKEN || ''
const query = { city: 'Алматы', date: '2026-11-14', event_type: 'корпоратив', category: 'Ведущий', budget_kzt: 1500000, duration_hours: 6, language: 'русский', preferences: '' }
const description = 'Авторская программа: музыкальная викторина и интерактивные игры с гостями.'

async function search(request: APIRequestContext) {
  const response = await request.post('/api/recommend', { data: query })
  expect(response.status()).toBe(200)
  return response.json()
}

async function login(page: Page) {
  await page.goto('/#/admin')
  await page.getByLabel('Токен администратора').fill(token)
  await page.getByRole('button', { name: 'Войти в панель', exact: true }).click()
  await expect(page.getByLabel('Статус анкет')).toBeVisible()
}

async function fillApplication(page: Page, name: string) {
  await page.getByLabel('Имя или название команды', { exact: true }).fill(name)
  await page.getByLabel('Город работы', { exact: true }).selectOption('Алматы')
  await page.getByLabel('Контактный email', { exact: true }).fill('browser-qa@example.com')
  await page.getByRole('checkbox', { name: 'Ведущий', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Корпоратив', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Русский', exact: true }).check()
  await page.getByLabel('Расскажите о своих услугах', { exact: true }).fill(description)
  await page.getByLabel('Стоимость от, ₸', { exact: true }).fill('1')
  await page.getByLabel('Максимальная длительность, ч', { exact: true }).fill('8')
  await page.getByRole('checkbox', { name: /Это вымышленная тестовая анкета/ }).check()
}

test('public application -> pending -> approved -> rejected -> deleted using real UI and API', async ({ page, request }) => {
  const name = 'Браузер QA ' + Date.now()
  await page.goto('/#/apply')
  await fillApplication(page, name)
  const submission = page.waitForResponse(r => r.url().endsWith('/api/applications') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Отправить на проверку', exact: true }).click()
  const receipt = await submission
  expect(receipt.status()).toBe(201)
  const id = (await receipt.json()).id
  await expect(page.getByRole('heading', { name: 'Анкета отправлена' })).toBeVisible()
  expect((await search(request)).cards.map((c: { id: string }) => c.id)).not.toContain(id)

  await login(page)
  await page.getByLabel('Статус анкет').selectOption('pending')
  await page.getByRole('button', { name: 'Открыть анкету ' + name, exact: true }).click()
  await expect(page.getByText('browser-qa@example.com', { exact: true })).toBeVisible()
  const approval = page.waitForResponse(r => r.url().endsWith('/moderate') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Одобрить анкету', exact: true }).click()
  expect((await approval).status()).toBe(200)
  expect((await search(request)).cards[0].id).toBe(id)
  await page.getByLabel('Статус анкет').selectOption('approved')
  await page.getByRole('button', { name: 'Открыть анкету ' + name, exact: true }).click()
  await page.getByLabel('Комментарий администратора').fill('Проверка отклонения QA')
  const rejection = page.waitForResponse(r => r.url().endsWith('/moderate') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Отклонить анкету', exact: true }).click()
  expect((await rejection).status()).toBe(200)
  expect((await search(request)).cards.map((c: { id: string }) => c.id)).not.toContain(id)
  await page.getByLabel('Статус анкет').selectOption('rejected')
  await page.getByRole('button', { name: 'Открыть анкету ' + name, exact: true }).click()
  await page.getByRole('button', { name: 'Удалить анкету', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(name)
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Удалить анкету', exact: true }).click()
  const deletion = page.waitForResponse(r => r.request().method() === 'DELETE')
  await page.getByRole('button', { name: 'Удалить навсегда', exact: true }).click()
  expect((await deletion).status()).toBe(204)
  await expect(page.getByRole('button', { name: 'Открыть анкету ' + name, exact: true })).toHaveCount(0)
  expect((await search(request)).cards.map((c: { id: string }) => c.id)).not.toContain(id)
})

test('application validation prevents invalid request and does not ask for passwords', async ({ page }) => {
  let calls = 0
  page.on('request', request => { if (request.url().endsWith('/api/applications')) calls++ })
  await page.goto('/#/apply')
  await page.getByRole('button', { name: 'Отправить на проверку', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Проверьте отмеченные поля анкеты')
  expect(calls).toBe(0)
  await fillApplication(page, 'Валидация QA')
  for (const value of ['2027-01-01', '2026-11-14, 2026-11-14']) {
    await page.getByLabel('Занятые даты', { exact: true }).fill(value)
    await page.getByRole('button', { name: 'Отправить на проверку', exact: true }).click()
    await expect(page.getByLabel('Занятые даты', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  }
  expect(calls).toBe(0)
  expect(await page.locator('input[type=password]').count()).toBe(0)
})

test('admin token is memory-only and is cleared on logout and reload', async ({ page }) => {
  await login(page)
  const stores = await page.evaluate(() => ({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage), cookie: document.cookie, url: location.href }))
  expect(JSON.stringify(stores)).not.toContain(token)
  await page.getByRole('button', { name: 'Выйти из панели', exact: true }).click()
  await expect(page.getByLabel('Токен администратора')).toHaveValue('')
  await login(page)
  await page.reload()
  await expect(page.getByLabel('Токен администратора')).toHaveValue('')
  await expect(page.getByLabel('Статус анкет')).toHaveCount(0)
})

test('alternatives remain separate, display changes and require a second explicit search', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Город', { exact: true }).selectOption('Алматы')
  await page.getByLabel('Дата', { exact: true }).fill('2026-11-14')
  await page.getByLabel('Тип мероприятия', { exact: true }).selectOption('корпоратив')
  await page.getByLabel('Кого ищем?', { exact: true }).selectOption('Ведущий')
  await page.getByLabel('Бюджет до', { exact: true }).fill('600000')
  await page.getByLabel('Язык', { exact: true }).selectOption('русский')
  await page.getByLabel('Длительность, ч', { exact: true }).fill('6')
  let count = 0
  page.on('request', request => { if (request.url().endsWith('/api/recommend')) count++ })
  const pending = page.waitForResponse(r => r.url().endsWith('/api/recommend'))
  await page.getByRole('button', { name: 'Подобрать подрядчиков', exact: true }).click()
  const result = await (await pending).json()
  expect(result.status).toBe('no_match')
  expect(result.cards).toEqual([])
  await expect(page.getByRole('heading', { name: 'Пока нет точного совпадения' })).toBeVisible()
  const region = page.getByRole('region', { name: 'Альтернативные подрядчики' })
  await expect(region).toBeVisible()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  }
  const alternative = result.alternatives[0]
  await region.getByRole('button', { name: 'Применить условия для ' + alternative.card.name, exact: true }).click()
  await expect(page.getByText(/Условия изменены:/)).toBeVisible()
  expect(count).toBe(1)
  for (const [field, value] of Object.entries(alternative.changes)) {
    if (value !== null) await expect(page.locator('#' + field)).toHaveValue(String(value))
  }
  const repeat = page.waitForResponse(r => r.url().endsWith('/api/recommend'))
  await page.getByRole('button', { name: 'Подобрать подрядчиков', exact: true }).click()
  expect((await (await repeat).json()).eligible_count).toBeGreaterThan(0)
  expect(count).toBe(2)
})

test('application and admin are accessible and fit mobile viewport', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const route of ['/#/apply', '/#/admin']) {
      await page.goto(route)
      if (route.endsWith('apply')) await expect(page.getByLabel('Имя или название команды', { exact: true })).toBeVisible()
      else await expect(page.getByLabel('Токен администратора')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      expect(result.violations).toEqual([])
    }
    await login(page)
    await page.getByRole('button', { name: /Открыть анкету / }).first().click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  }
})
