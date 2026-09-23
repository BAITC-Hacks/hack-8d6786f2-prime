const path = require('node:path')
const frontend = process.env.QA_FRONTEND_ROOT || path.resolve(__dirname, '..')
const { test, expect } = require(path.join(frontend, 'node_modules/@playwright/test'))
const AxeBuilder = require(path.join(frontend, 'node_modules/@axe-core/playwright')).default
const pictures =
  process.env.QA_SCREENSHOT_DIR || path.join(process.cwd(), 'test-results/screenshots')

async function fill(page, changes = {}) {
  await page.goto('/')
  const q = {
    city: 'Алматы',
    date: '2026-11-14',
    event_type: 'корпоратив',
    category: 'Ведущий',
    budget_kzt: '1500000',
    language: 'русский',
    duration_hours: '6',
    ...changes,
  }
  for (const [field, label] of [
    ['city', 'Город'],
    ['event_type', 'Тип мероприятия'],
    ['category', 'Категория'],
    ['language', 'Язык'],
  ])
    await page.getByLabel(label, { exact: true }).selectOption(q[field])
  for (const [field, label] of [
    ['date', 'Дата'],
    ['budget_kzt', 'Бюджет до'],
    ['duration_hours', 'Длительность, ч'],
  ])
    await page.getByLabel(label, { exact: true }).fill(q[field])
}
async function search(page) {
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/api/recommend') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Подобрать подрядчиков', exact: true }).click()
  const response = await pending
  expect(response.status()).toBe(200)
  return response.json()
}
async function layout(page, name) {
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([])
    await page.screenshot({ path: path.join(pictures, `${name}-${width}.png`), fullPage: true })
  }
}

test('latest: exact matches retain API text and visible source evidence on mobile and desktop', async ({
  page,
}) => {
  await fill(page)
  const result = await search(page)
  expect(result.cards.map((c) => c.id)).toEqual(['HK-44923', 'HK-29829', 'HK-27222'])
  await expect(
    page.getByRole('heading', { name: 'Подобрали по вашим условиям', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Базовые объяснения по данным каталога (fallback).', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('article')).toHaveCount(3)
  for (const [i, card] of result.cards.entries()) {
    const article = page.locator('article').nth(i)
    await expect(article.locator('.explanation p')).toHaveText(card.explanation)
    await expect(article.locator('blockquote')).toHaveText(
      card.evidence.filter((e) => e.field === 'description').map((e) => e.value),
    )
  }
  await layout(page, 'latest-matched')
})

test('latest: one alternative group deduplicates identical changes and requires explicit search', async ({
  page,
}) => {
  await fill(page, { budget_kzt: '600000' })
  let count = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/api/recommend')) count++
  })
  const result = await search(page)
  expect(result.status).toBe('no_match')
  expect(result.cards).toEqual([])
  await expect(
    page.getByRole('heading', { name: 'Кандидаты есть, условия не совпали', exact: true }),
  ).toBeVisible()
  const group = page.getByRole('region', { name: 'Варианты с изменением условий', exact: true })
  await expect(group).toHaveCount(1)
  const key = (changes) => JSON.stringify(Object.entries(changes).sort())
  const distinct = new Set(result.alternatives.map((a) => key(a.changes)))
  let extra = 0
  for (const s of result.suggestions)
    if (Object.keys(s.changes).length && !distinct.has(key(s.changes))) {
      distinct.add(key(s.changes))
      extra++
    }
  await expect(group.getByRole('button')).toHaveCount(result.alternatives.length + extra)
  await expect(page.getByText('Можно попробовать иначе', { exact: true })).toHaveCount(0)
  await expect(page.locator('.cards article')).toHaveCount(0)
  await layout(page, 'latest-alternatives')
  const choice = result.alternatives[0]
  await group
    .getByRole('button', { name: 'Применить условия для ' + choice.card.name, exact: true })
    .click()
  await expect(page.getByText(/Условия изменены:/)).toBeVisible()
  expect(count).toBe(1)
  for (const [field, value] of Object.entries(choice.changes))
    await expect(page.locator('#' + field)).toHaveValue(value === null ? '' : String(value))
  for (const field of ['city', 'category', 'event_type'])
    await expect(page.locator('#' + field)).toHaveValue(result.query[field])
  const next = await search(page)
  expect(next.status).toBe('matched')
  expect(next.cards.map((c) => c.id)).toContain(choice.card.id)
  expect(count).toBe(2)
})

test('latest: rare and absent results have explicit outcomes and visible data notices', async ({
  page,
}) => {
  await fill(page, {
    category: 'Флорист',
    event_type: 'свадьба',
    budget_kzt: '300000',
    language: '',
    duration_hours: '8',
  })
  const rare = await search(page)
  expect(rare.cards.map((c) => c.id)).toEqual(['HK-90001'])
  await expect(page.getByText('Почему меньше трёх', { exact: true })).toBeVisible()
  await expect(page.getByText('Вымышленный профиль', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Длительность присутствия не применяется', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('article details')).not.toHaveAttribute('open')
  await fill(page, { city: 'Астана', category: 'Декоратор' })
  expect((await search(page)).status).toBe('no_category')
  await expect(
    page.getByRole('heading', { name: 'Такой категории в городе нет', exact: true }),
  ).toBeVisible()
  await expect(page.locator('article')).toHaveCount(0)
  await expect(page.getByLabel('Причины исключения', { exact: true })).toHaveCount(0)
})

test('latest: frontend displays the source quote and explanation returned by the API', async ({
  page,
}) => {
  await fill(page, {
    date: '2026-09-23',
    event_type: 'свадьба',
    budget_kzt: '10000000',
    language: 'казахский',
    duration_hours: '10',
  })
  const result = await search(page)
  const index = result.cards.findIndex((c) => c.id === 'HK-42352')
  expect(index).toBeGreaterThanOrEqual(0)
  const card = result.cards[index]
  const quote = card.evidence.find((e) => e.field === 'description').value
  const article = page.locator('article').nth(index)
  await expect(article.locator('blockquote')).toHaveText(quote)
  await expect(article.locator('.explanation p')).toHaveText(card.explanation)
  // Rendering must match the API both before and after backend quality fixes.
})
