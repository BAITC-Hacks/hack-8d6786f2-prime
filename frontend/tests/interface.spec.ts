import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  makeMockResponse,
  mockCards,
  mockOptions,
  mockQuery,
  type Scenario,
} from '../src/mocks/fixtures'

async function prepare(page: Page, scenario: Scenario = 'matched') {
  await page.route('**/api/options', (route) => route.fulfill({ json: mockOptions }))
  await page.route('**/api/recommend', async (route) =>
    route.fulfill({ json: makeMockResponse(route.request().postDataJSON(), scenario) }),
  )
  await page.goto('/')
}
async function fill(page: Page) {
  await page.getByLabel('Город', { exact: true }).selectOption('Алматы')
  await page.getByLabel('Дата', { exact: true }).fill('2026-11-14')
  await page.getByLabel('Тип мероприятия', { exact: true }).selectOption('корпоратив')
  await page.getByLabel('Кого ищем?', { exact: true }).selectOption('Ведущий')
  await page.getByLabel('Бюджет до', { exact: true }).fill('1500000')
}
async function search(page: Page) {
  await fill(page)
  await page.getByRole('button', { name: 'Подобрать подрядчиков', exact: true }).click()
}
test('initial state, keyboard, dialog and screenshot', async ({ page }) => {
  await prepare(page)
  await expect(page.getByRole('heading', { name: 'Те, кто подойдёт именно вам' })).toBeVisible()
  await expect(page.locator('article')).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Перейти к подбору' })).toBeFocused()
  await page.getByRole('button', { name: 'Как это работает' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.locator('h1').click()
  await page.screenshot({ path: 'test-results/screenshots/initial-desktop.png', fullPage: true })
})
test('matched order, count, descriptions, annotations and accessible desktop', async ({ page }) => {
  await prepare(page)
  let payload: unknown
  await page.route('**/api/recommend', async (route) => {
    payload = route.request().postDataJSON()
    const response = makeMockResponse(payload as typeof mockQuery)
    response.cards.push({ ...mockCards[0], id: 'extra-4', name: 'Четвёртый кандидат' })
    await route.fulfill({ json: response })
  })
  await search(page)
  await expect(page.locator('article')).toHaveCount(3)
  expect(payload).toEqual({ ...mockQuery, duration_hours: null, language: null })
  await expect(page.locator('article h3')).toHaveText(['Алексей С.', 'Марат К.', 'Дана А.'])
  await expect(page.getByText('Показано 3 из 4')).toBeVisible()
  await page.locator('article').last().locator('summary').click()
  await expect(page.getByText(/Цена заполнена при подготовке каталога/)).toBeVisible()
  await expect(page.getByText(/Город заполнен при подготовке каталога/)).toBeVisible()
  await page.locator('article').last().locator('summary').click()
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
  await page.locator('h1').click()
  await page.screenshot({ path: 'test-results/screenshots/matched-desktop.png', fullPage: true })
})
for (const scenario of ['one', 'two', 'no_category', 'no_match', 'fallback'] as const) {
  test('response state: ' + scenario, async ({ page }) => {
    await prepare(page, scenario)
    await search(page)
    if (scenario === 'one' || scenario === 'two')
      await expect(page.locator('article')).toHaveCount(scenario === 'one' ? 1 : 2)
    if (scenario === 'no_category')
      await expect(
        page.getByRole('heading', { name: 'В этом городе пока нет такой категории' }),
      ).toBeVisible()
    if (scenario === 'no_match') {
      await expect(page.getByRole('heading', { name: 'Пока нет точного совпадения' })).toBeVisible()
      await page.locator('h1').click()
      await page.screenshot({
        path: 'test-results/screenshots/no-match-desktop.png',
        fullPage: true,
      })
      await page.getByRole('button', { name: /Проверить другую дату/ }).click()
      await expect(page.getByLabel('Дата', { exact: true })).toHaveValue('2026-11-15')
      await expect(page.getByText(/Условия изменены: дата/)).toBeVisible()
      await expect(page.locator('article')).toHaveCount(0)
    }
    if (scenario === 'fallback')
      await expect(page.getByText('Базовые объяснения по данным каталога.')).toBeVisible()
  })
}
test('null max_hours is inapplicable and is never 0 or 24h', async ({ page }) => {
  await prepare(page, 'one')
  await page.route('**/api/recommend', (route) => {
    const response = makeMockResponse(mockQuery, 'one')
    response.cards[0].max_hours = null
    return route.fulfill({ json: response })
  })
  await search(page)
  await page.locator('article summary').click()
  await expect(
    page.getByText('Для этой услуги длительность присутствия не применяется.'),
  ).toBeVisible()
  await expect(page.locator('article')).not.toContainText('До 0')
  await expect(page.locator('article')).not.toContainText('24 ч')
})
test('loading prevents repeat requests and is visibly announced', async ({ page }) => {
  await prepare(page)
  let release!: () => void
  const pending = new Promise<void>((r) => {
    release = r
  })
  await page.route('**/api/recommend', async (route) => {
    await pending
    await route.fulfill({ json: makeMockResponse() })
  })
  await search(page)
  await expect(page.getByRole('button', { name: 'Подбираем…' })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'Ищем совпадения' })).toBeVisible()
  release()
  await expect(page.locator('article')).toHaveCount(3)
})
test('422 maps errors and a subsequent request recovers', async ({ page }) => {
  await prepare(page)
  await page.route('**/api/recommend', (route) =>
    route.fulfill({
      status: 422,
      json: { detail: [{ loc: ['body', 'date'], msg: 'internal detail', type: 'value_error' }] },
    }),
  )
  await search(page)
  await expect(page.getByLabel('Дата', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('body')).not.toContainText('internal detail')
  await expect(page.locator('article')).toHaveCount(0)
  await page.route('**/api/recommend', (route) => route.fulfill({ json: makeMockResponse() }))
  await page.getByRole('button', { name: 'Повторить подбор' }).click()
  await expect(page.locator('article')).toHaveCount(3)
})
test('server, network and options errors have no fallback fixtures', async ({ page }) => {
  await prepare(page)
  await page.route('**/api/recommend', (route) =>
    route.fulfill({ status: 500, body: 'private internals' }),
  )
  await search(page)
  await expect(
    page.getByText('Сервис временно не отвечает. Попробуйте ещё раз чуть позже.'),
  ).toBeVisible()
  await expect(page.locator('article')).toHaveCount(0)
  await page.route('**/api/recommend', (route) => route.abort())
  await page.getByRole('button', { name: 'Повторить подбор' }).click()
  await expect(
    page.getByText('Не удалось связаться с сервисом. Проверьте соединение и повторите попытку.'),
  ).toBeVisible()
  await page.route('**/api/options', (route) => route.fulfill({ status: 500 }))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Повторить загрузку' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Подобрать подрядчиков', exact: true }),
  ).toBeDisabled()
  await page.route('**/api/options', (route) => route.fulfill({ json: mockOptions }))
  await page.getByRole('button', { name: 'Повторить загрузку' }).click()
  await expect(page.getByLabel('Город', { exact: true })).toBeEnabled()
})
test('calendar and required validation prevent invalid requests', async ({ page }) => {
  await prepare(page)
  let count = 0
  page.on('request', (req) => {
    if (req.url().endsWith('/api/recommend')) count++
  })
  await page.getByRole('button', { name: 'Подобрать подрядчиков', exact: true }).click()
  await expect(page.getByText('Проверьте отмеченные поля.')).toBeVisible()
  await fill(page)
  await page.getByLabel('Дата', { exact: true }).fill('2027-01-01')
  await page.getByRole('button', { name: 'Подобрать подрядчиков', exact: true }).click()
  await expect(page.getByText('Выберите дату в доступном календаре.')).toBeVisible()
  expect(count).toBe(0)
})
for (const width of [360, 390, 1280]) {
  test('layout and accessibility at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await prepare(page)
    await search(page)
    await expect(page.locator('article')).toHaveCount(3)
    const bounds = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }))
    expect(bounds.page).toBeLessThanOrEqual(bounds.viewport)
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([])
    await page.locator('h1').click()
    await page.screenshot({
      path: 'test-results/screenshots/matched-' + width + '.png',
      fullPage: true,
    })
  })
}
test('the interface contains only the seven case inputs and recommendation navigation', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('#city option')).toHaveCount(mockOptions.cities.length + 1)
  await expect(page.locator('#event-form input, #event-form select')).toHaveCount(7)
  await expect(page.locator('#event-form textarea')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Подрядчикам' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Администратору' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Подобрать подрядчиков' })).toBeVisible()
})
