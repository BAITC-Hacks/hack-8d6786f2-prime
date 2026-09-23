import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.skip(process.env.RUN_BACKEND_TESTS !== '1', 'Requires the isolated real backend')

test('alternatives remain separate, display changes and require a second explicit search', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByLabel('Город', { exact: true }).selectOption('Алматы')
  await page.getByLabel('Дата', { exact: true }).fill('2026-11-14')
  await page.getByLabel('Тип мероприятия', { exact: true }).selectOption('корпоратив')
  await page.getByLabel('Кого ищем?', { exact: true }).selectOption('Ведущий')
  await page.getByLabel('Бюджет до', { exact: true }).fill('600000')
  await page.getByLabel('Язык', { exact: true }).selectOption('русский')
  await page.getByLabel('Длительность, ч', { exact: true }).fill('6')
  let count = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api/recommend')) count++
  })
  const pending = page.waitForResponse((r) => r.url().endsWith('/api/recommend'))
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
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([])
  }
  const alternative = result.alternatives[0]
  await region
    .getByRole('button', { name: 'Применить условия для ' + alternative.card.name, exact: true })
    .click()
  await expect(page.getByText(/Условия изменены:/)).toBeVisible()
  expect(count).toBe(1)
  for (const [field, value] of Object.entries(alternative.changes)) {
    if (value !== null) await expect(page.locator('#' + field)).toHaveValue(String(value))
  }
  const repeat = page.waitForResponse((r) => r.url().endsWith('/api/recommend'))
  await page.getByRole('button', { name: 'Подобрать подрядчиков', exact: true }).click()
  expect((await (await repeat).json()).eligible_count).toBeGreaterThan(0)
  expect(count).toBe(2)
})
