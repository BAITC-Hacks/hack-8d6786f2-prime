import { fillForm, searchAndRead, type FormOverrides } from './form'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { recommendationSchema } from '../src/contracts'
import evaluation from '../../qa/evaluation-cases.json' with { type: 'json' }

test.skip(
  process.env.RUN_BACKEND_TESTS !== '1',
  'Requires the real backend running at 127.0.0.1:8000',
)

async function fillRealForm(page: Page, overrides: FormOverrides = {}) {
  await page.goto('/')
  await fillForm(page, { language: 'русский', duration: '6', ...overrides })
}
const recommend = searchAndRead
test('real API options, ranked matches, fallback, desktop and mobile', async ({
  page,
  request,
}) => {
  const options = await (await request.get('/api/options')).json()
  expect(options.dataset.profiles_count).toBe(66)
  expect(options.categories).toHaveLength(17)
  await fillRealForm(page)
  await expect(page.locator('#category option')).toHaveCount(18)
  const result = await recommend(page)
  expect(result.eligible_count).toBe(4)
  expect(result.cards.map((c: { id: string }) => c.id)).toEqual([
    'HK-44923',
    'HK-29829',
    'HK-27222',
  ])
  await expect(page.locator('article h3')).toHaveText(
    result.cards.map((c: { name: string }) => c.name),
  )
  await expect(page.getByText('Показано 3 из 4')).toBeVisible()
  await expect(page.getByText('Базовые объяснения по данным каталога (fallback).')).toBeVisible()
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
  await page.locator('h1').click()
  await page.screenshot({ path: 'test-results/screenshots/real-api-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('h1').click()
  await page.screenshot({ path: 'test-results/screenshots/real-api-mobile.png', fullPage: true })
})
test('real no_match suggestion changes date and then returns one candidate', async ({ page }) => {
  await fillRealForm(page, { budget: '600000' })
  const initial = await recommend(page)
  expect(initial.status).toBe('no_match')
  const dateChange = initial.suggestions[0].changes.date
  const dateAlternative = initial.alternatives?.find(
    (alternative: { changes: Record<string, unknown> }) =>
      Object.keys(alternative.changes).length === 1 && alternative.changes.date === dateChange,
  )
  const button = dateAlternative
    ? 'Применить условия для ' + dateAlternative.card.name
    : initial.suggestions[0].label
  await page.getByRole('button', { name: button }).click()
  await expect(page.getByLabel('Бюджет до', { exact: true })).toHaveValue('600000')
  await expect(page.getByLabel('Дата', { exact: true })).toHaveValue('2026-11-15')
  const next = await recommend(page)
  expect(next.cards.map((c: { id: string }) => c.id)).toEqual(['HK-88430'])
  await expect(page.locator('article')).toHaveCount(1)
})
test('real synthetic florist keeps null language and inapplicable duration', async ({ page }) => {
  await fillRealForm(page, {
    category: 'Флорист',
    event: 'свадьба',
    budget: '300000',
    language: '',
    duration: '8',
  })
  const result = await recommend(page)
  expect(result.query.language).toBeNull()
  expect(result.cards[0].id).toBe('HK-90001')
  expect(result.cards[0].max_hours).toBeNull()
  await expect(page.getByText('Вымышленный профиль', { exact: true })).toBeVisible()
  await page.locator('article summary').click()
  await expect(page.getByText('Длительность присутствия не применяется')).toBeVisible()
})
test('real no_category stays distinct from constrained no_match', async ({ page }) => {
  await fillRealForm(page, { city: 'Астана', category: 'Декоратор' })
  const result = await recommend(page)
  expect(result.status).toBe('no_category')
  await expect(
    page.getByRole('heading', { name: 'В этом городе пока нет такой категории' }),
  ).toBeVisible()
  await expect(page.locator('article')).toHaveCount(0)
})

test('real source explanations distinguish bands and keep the wedding fact complete', async ({
  page,
}) => {
  await fillRealForm(page, {
    category: 'Лайв-бэнд',
    event: 'свадьба',
    date: '2026-09-23',
    budget: '10000000',
    language: '',
    duration: '',
  })
  const bands = await recommend(page)
  for (const [id, fact] of [
    ['HK-23752', 'два вокалиста'],
    ['HK-83709', 'струнный квартет'],
  ]) {
    const card = bands.cards.find((item: { id: string }) => item.id === id)
    expect(card).toBeDefined()
    await expect(page.getByRole('article', { name: card!.name, exact: true })).toContainText(fact)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({
    path: 'test-results/screenshots/band-evidence-mobile.png',
    fullPage: true,
  })
  await fillRealForm(page, {
    event: 'свадьба',
    date: '2026-09-23',
    budget: '10000000',
    language: 'казахский',
    duration: '10',
  })
  const hosts = await recommend(page)
  const host = hosts.cards.find((item: { id: string }) => item.id === 'HK-42352')
  const card = page.getByRole('article', { name: host!.name, exact: true })
  await expect(card.locator('blockquote')).toHaveText('Опыт ведения свадеб 13 лет')
  await expect(card.locator('.explanation')).not.toContainText('чтобы этот')
})

test('real date change distinguishes newly busy, newly free and rank cutoff', async ({ page }) => {
  await fillRealForm(page)
  const before = await recommend(page)
  await page.getByLabel('Дата', { exact: true }).fill('2026-11-15')
  const after = await recommend(page)
  const comparison = page.getByRole('region', { name: 'Что изменилось при смене даты' })
  await expect(comparison).toBeVisible()
  for (const [id, text] of [
    ['HK-29829', 'Стал занят'],
    ['HK-88430', 'На прежнюю дату был занят'],
    ['HK-27222', 'По-прежнему свободен'],
  ]) {
    const name = [...before.assessments, ...after.assessments].find((row) => row.id === id)!.name
    await expect(comparison.getByRole('listitem').filter({ hasText: name })).toContainText(text)
  }
  await expect(page.getByText('Заняты на дату: 2', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({
    path: 'test-results/screenshots/date-comparison-mobile.png',
    fullPage: true,
  })
  await page.getByLabel('Бюджет до', { exact: true }).fill('2000000')
  await recommend(page)
  await expect(comparison).toHaveCount(0)
})

test('all 28 evaluation responses satisfy the browser runtime schema and expected outcome', async ({
  request,
}) => {
  for (const item of evaluation.cases) {
    const response = await request.post('/api/recommend', { data: item.query })
    expect(response.status(), item.id).toBe(200)
    const result = recommendationSchema.parse(await response.json())
    expect(result.meta.dataset_version).toBe(evaluation.dataset_version)
    expect({ status: result.status, cards: result.cards.map((row) => row.id) }, item.id).toEqual(
      item.expected,
    )
  }
})
