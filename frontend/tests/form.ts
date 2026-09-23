import { expect, type Page } from '@playwright/test'
import { recommendationSchema } from '../src/contracts'

export type FormOverrides = {
  city?: string
  date?: string
  event?: string
  category?: string
  budget?: string
  language?: string
  duration?: string
}

export async function fillForm(page: Page, overrides: FormOverrides = {}) {
  await page.getByLabel('Город', { exact: true }).selectOption(overrides.city ?? 'Алматы')
  await page.getByLabel('Дата', { exact: true }).fill(overrides.date ?? '2026-11-14')
  await page
    .getByLabel('Тип мероприятия', { exact: true })
    .selectOption(overrides.event ?? 'корпоратив')
  await page.getByLabel('Категория', { exact: true }).selectOption(overrides.category ?? 'Ведущий')
  await page.getByLabel('Бюджет до', { exact: true }).fill(overrides.budget ?? '1500000')
  await page.getByLabel('Язык', { exact: true }).selectOption(overrides.language ?? '')
  await page.getByLabel('Длительность, ч', { exact: true }).fill(overrides.duration ?? '')
}

export async function searchAndRead(page: Page) {
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/api/recommend') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Подобрать подрядчиков', exact: true }).click()
  const response = await pending
  expect(response.status()).toBe(200)
  return recommendationSchema.parse(await response.json())
}
