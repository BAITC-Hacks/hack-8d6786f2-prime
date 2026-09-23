import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.skip(
  process.env.RUN_BACKEND_TESTS !== '1',
  'Requires the real backend running at 127.0.0.1:8000',
)

async function fillRealForm(
  page: Page,
  overrides: {
    city?: string
    date?: string
    category?: string
    event?: string
    budget?: string
    language?: string
    duration?: string
  } = {},
) {
  await page.goto('/')
  await page.getByLabel('Город', { exact: true }).selectOption(overrides.city ?? 'Алматы')
  await page.getByLabel('Дата', { exact: true }).fill(overrides.date ?? '2026-11-14')
  await page
    .getByLabel('Тип мероприятия', { exact: true })
    .selectOption(overrides.event ?? 'корпоратив')
  await page.getByLabel('Кого ищем?', { exact: true }).selectOption(overrides.category ?? 'Ведущий')
  await page.getByLabel('Бюджет до', { exact: true }).fill(overrides.budget ?? '1500000')
  await page.getByLabel('Язык', { exact: true }).selectOption(overrides.language ?? 'русский')
  await page.getByLabel('Длительность, ч', { exact: true }).fill(overrides.duration ?? '6')
}
async function recommend(page: Page) {
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/api/recommend') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Подобрать подрядчиков', exact: true }).click()
  const response = await pending
  expect(response.status()).toBe(200)
  return response.json()
}
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
  await expect(page.getByText('Базовые объяснения по данным каталога.')).toBeVisible()
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
  await page.locator('h1').click()
  await page.screenshot({ path: 'docs/screenshots/real-api-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('h1').click()
  await page.screenshot({ path: 'docs/screenshots/real-api-mobile.png', fullPage: true })
})
test('real no_match suggestion changes date and then returns one candidate', async ({ page }) => {
  await fillRealForm(page, { budget: '600000' })
  const initial = await recommend(page)
  expect(initial.status).toBe('no_match')
  await page.getByRole('button', { name: initial.suggestions[0].label }).click()
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
  await expect(
    page.getByText('Для этой услуги длительность присутствия не применяется.'),
  ).toBeVisible()
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
