import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { ApiError, type Api } from './api'
import type { Recommendation } from './contracts'
import { makeMockResponse, mockCards, mockOptions, mockQuery } from './mocks/fixtures'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
async function setup(client: Api) {
  render(<App client={client} />)
  await screen.findByRole('option', { name: 'Алматы' })
  for (const [name, value] of Object.entries(mockQuery)) {
    const field = document.querySelector('[name="' + name + '"]')
    if (field) fireEvent.change(field, { target: { value: value === null ? '' : String(value) } })
  }
}
const submit = () => fireEvent.submit(document.getElementById('event-form')!)
describe('request lifecycle', () => {
  it('prevents duplicate submissions and ignores stale results even if transport ignores abort', async () => {
    const first = deferred<Recommendation>()
    const second = deferred<Recommendation>()
    const recommend = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await setup({ getOptions: async () => mockOptions, recommend })
    submit()
    submit()
    expect(recommend).toHaveBeenCalledTimes(1)
    fireEvent.change(document.getElementById('budget_kzt')!, { target: { value: '2000000' } })
    submit()
    expect(recommend).toHaveBeenCalledTimes(2)
    const current = makeMockResponse({ ...mockQuery, budget_kzt: 2000000 }, 'one')
    current.cards[0].name = 'Актуальный кандидат'
    second.resolve(current)
    await screen.findByRole('heading', { name: 'Актуальный кандидат' })
    first.resolve(makeMockResponse())
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Марат К.' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { name: 'Актуальный кандидат' })).toBeInTheDocument()
  })
  it('applies suggestions visibly, keeps nulls and does not silently submit', async () => {
    const recommend = vi.fn().mockResolvedValue(makeMockResponse(mockQuery, 'no_match'))
    await setup({ getOptions: async () => mockOptions, recommend })
    submit()
    await screen.findByRole('heading', { name: 'Пока нет точного совпадения' })
    fireEvent.click(screen.getByRole('button', { name: /Проверить другую дату/ }))
    expect(document.getElementById('date')).toHaveValue('2026-11-15')
    expect(recommend).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Условия изменены: дата/)).toBeVisible()
  })
  it('clears stale cards on edits and displays a field-specific API error', async () => {
    const recommend = vi
      .fn()
      .mockResolvedValueOnce(makeMockResponse())
      .mockRejectedValueOnce(new ApiError('Проверьте условия', { date: 'Неверная дата' }))
    await setup({ getOptions: async () => mockOptions, recommend })
    submit()
    await screen.findByRole('heading', { name: 'Марат К.' })
    fireEvent.change(document.getElementById('date')!, { target: { value: '2026-11-15' } })
    expect(screen.queryByRole('heading', { name: 'Марат К.' })).not.toBeInTheDocument()
    submit()
    await screen.findByText('Неверная дата')
    expect(document.getElementById('date')).toHaveAttribute('aria-invalid', 'true')
    expect(document.activeElement?.id).toBe('date')
  })
  it('shows alternatives separately with date suggestions and applies all changes without auto-search', async () => {
    const changes = {
      date: '2026-11-15',
      budget_kzt: 2000000,
      language: null,
      duration_hours: null,
    }
    const response: Recommendation = {
      ...makeMockResponse(mockQuery, 'no_match'),
      alternatives: [
        {
          card: { ...mockCards[0], available_on: changes.date },
          changes,
          differences: [
            {
              field: 'date',
              requested: '14 ноября',
              proposed: '15 ноября',
              reason: 'Свободен на следующий день.',
            },
            {
              field: 'budget_kzt',
              requested: '1 500 000 ₸',
              proposed: '2 000 000 ₸',
              reason: 'Стоимость выше бюджета.',
            },
            {
              field: 'language',
              requested: 'Русский',
              proposed: 'Без ограничения',
              reason: 'Другой язык.',
            },
            {
              field: 'duration_hours',
              requested: '6 ч',
              proposed: 'Без ограничения',
              reason: 'Длительность нужно уточнить.',
            },
          ],
          explanation_mode: 'fallback',
        },
      ],
    }
    const recommend = vi.fn().mockResolvedValue(response)
    await setup({ getOptions: async () => mockOptions, recommend })
    submit()
    const alternatives = await screen.findByRole('region', {
      name: 'Варианты с изменением условий',
    })
    expect(screen.getByRole('heading', { name: 'Пока нет точного совпадения' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Проверить другую дату/ })).toBeVisible()
    expect(screen.getByText('Предлагаемая дата: 15 ноября')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Почему подходит' })).not.toBeInTheDocument()
    expect(screen.getByText('Базовое объяснение по данным каталога (fallback).')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Почему подходит после изменений' })).toBeVisible()
    for (const difference of response.alternatives![0].differences) {
      expect(within(alternatives).getByText(difference.reason)).toBeVisible()
    }
    expect(within(alternatives).getByText(/Язык: Русский → Без ограничения/)).toBeVisible()
    expect(within(alternatives).getByText(/Длительность: 6 ч → Без ограничения/)).toBeVisible()
    expect(document.getElementById('date')).toHaveValue(mockQuery.date)
    expect(document.getElementById('budget_kzt')).toHaveValue(String(mockQuery.budget_kzt))
    fireEvent.click(screen.getByRole('button', { name: 'Применить условия для Алексей С.' }))
    expect(recommend).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Условия изменены: дата — 15 ноября 2026 г./)).toBeVisible()
    expect(screen.getByText(/язык — без ограничений; длительность — без ограничений/)).toBeVisible()
    await waitFor(() => expect(document.getElementById('date')).toHaveFocus())
    for (const [field, value] of Object.entries(changes)) {
      expect(document.getElementById(field)).toHaveValue(value === null ? '' : String(value))
    }
    for (const field of ['city', 'category', 'event_type'] as const) {
      expect(document.getElementById(field)).toHaveValue(mockQuery[field])
    }
    expect(
      screen.queryByRole('region', { name: 'Варианты с изменением условий' }),
    ).not.toBeInTheDocument()
    submit()
    await waitFor(() => expect(recommend).toHaveBeenCalledTimes(2))
    expect(recommend.mock.calls[1][0]).toEqual({ ...mockQuery, ...changes })
  })
  it('announces loading, focuses a network failure and lets the user retry', async () => {
    const pending = deferred<Recommendation>()
    const recommend = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(
        new ApiError('Не удалось связаться с сервисом. Проверьте соединение и повторите попытку.'),
      )
      .mockResolvedValueOnce(makeMockResponse())
    await setup({ getOptions: async () => mockOptions, recommend })
    submit()
    expect(screen.getByRole('button', { name: 'Подбираем…' })).toBeDisabled()
    expect(screen.getByRole('region', { name: 'Ищем совпадения' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByText('Проверяем условия и готовим объяснения…')).toBeVisible()
    pending.resolve(makeMockResponse())
    await screen.findByRole('heading', { name: 'Подобрали по вашим условиям' })
    submit()
    await screen.findByRole('alert')
    expect(screen.getByText(/Не удалось связаться с сервисом/)).toBeVisible()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Подбор пока не завершён' })).toHaveFocus(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Повторить подбор' }))
    await screen.findByRole('heading', { name: 'Подобрали по вашим условиям' })
    expect(recommend).toHaveBeenCalledTimes(3)
    expect(recommend.mock.calls[2][0]).toEqual(mockQuery)
  })
  it('focuses the first invalid field in visual order and never sends an invalid query', async () => {
    const recommend = vi.fn()
    render(<App client={{ getOptions: async () => mockOptions, recommend }} />)
    await screen.findByRole('option', { name: 'Алматы' })
    submit()
    expect(document.getElementById('city')).toHaveFocus()
    fireEvent.change(document.getElementById('city')!, { target: { value: 'Алматы' } })
    submit()
    expect(document.getElementById('date')).toHaveFocus()
    expect(document.getElementById('date')).toHaveAttribute('aria-describedby', 'date-error')
    expect(recommend).not.toHaveBeenCalled()
  })
})

describe('honest recommendation presentation', () => {
  it.each([
    ['matched', 'Подобрали по вашим условиям'],
    ['no_category', 'Такой категории в городе нет'],
    ['no_match', 'Кандидаты есть, условия не совпали'],
  ] as const)(
    'gives %s its own visible outcome and preserves the server summary',
    async (scenario, title) => {
      const response = makeMockResponse(mockQuery, scenario)
      await setup({ getOptions: async () => mockOptions, recommend: async () => response })
      submit()
      expect(await screen.findByRole('heading', { name: title })).toBeVisible()
      expect(screen.getByText(response.summary)).toBeVisible()
      expect(screen.queryAllByRole('article')).toHaveLength(scenario === 'matched' ? 3 : 0)
      if (scenario === 'matched') expect(screen.getByText('Показано 3 из 4')).toBeVisible()
      if (scenario === 'no_category')
        expect(screen.queryByLabelText('Причины исключения')).not.toBeInTheDocument()
      if (scenario === 'no_match') expect(screen.getByLabelText('Причины исключения')).toBeVisible()
    },
  )
  it.each(['one', 'two'] as const)(
    'keeps the reason for fewer than three cards: %s',
    async (scenario) => {
      const response = makeMockResponse(mockQuery, scenario)
      response.total_in_category = response.eligible_count + 1
      response.summary += ` Из ${response.total_in_category} профилей этой категории 1 не проходят условия. Причины исключения: заняты на выбранную дату — 1.`
      await setup({ getOptions: async () => mockOptions, recommend: async () => response })
      submit()
      expect(await screen.findByText('Почему меньше трёх')).toBeVisible()
      expect(screen.getByText(response.summary)).toBeVisible()
      expect(screen.getAllByRole('article')).toHaveLength(response.eligible_count)
      expect(
        screen.getByText(`Показано ${response.eligible_count} из ${response.eligible_count}`),
      ).toBeVisible()
    },
  )
  it('keeps repeated and unfinished server text intact and shows source evidence without inventing a replacement', async () => {
    const response = makeMockResponse(mockQuery, 'two')
    const excerpt = 'Музыка для свадьбы, чтобы этот'
    const explanation = `В описании профиля: «${excerpt}». <b>Исходный текст</b>`
    response.cards = response.cards.map((card) => ({
      ...card,
      explanation,
      evidence: [{ field: 'description', value: excerpt }],
    }))
    await setup({ getOptions: async () => mockOptions, recommend: async () => response })
    submit()
    await screen.findByRole('heading', { name: 'Подобрали по вашим условиям' })
    for (const article of screen.getAllByRole('article')) {
      expect(article.querySelector('.explanation p')?.textContent).toBe(explanation)
      expect(article.querySelector('.explanation b')).toBeNull()
      expect(article.querySelector('blockquote')?.textContent).toBe(excerpt)
      expect(within(article).getByText(excerpt)).toBeVisible()
    }
  })
  it('shows fallback, synthetic, prepared data, starting prices and inapplicable duration without expanding details', async () => {
    const response = makeMockResponse(mockQuery, 'one')
    response.meta.explanation_mode = 'fallback'
    response.cards[0] = {
      ...response.cards[0],
      max_hours: null,
      price_imputed: true,
      city_imputed: true,
      explanation: '',
    }
    await setup({ getOptions: async () => mockOptions, recommend: async () => response })
    submit()
    expect(
      await screen.findByText('Базовые объяснения по данным каталога (fallback).'),
    ).toBeVisible()
    for (const text of [
      'Вымышленный профиль',
      'Цена подготовлена',
      'Город подготовлен',
      'Длительность присутствия не применяется',
      'Объяснение не предоставлено.',
    ]) {
      expect(screen.getByText(text)).toBeVisible()
    }
    expect(screen.getByText(/Цена заполнена при подготовке каталога/)).toBeVisible()
    expect(screen.getByText(/Город заполнен при подготовке каталога/)).toBeVisible()
    expect(screen.getByText(/от 650\s000/)).toBeVisible()
    expect(document.querySelector('details')).not.toHaveAttribute('open')
  })
  it('combines suggestions and alternatives, removes only identical changes, and keeps a distinct date-only suggestion', async () => {
    const response = makeMockResponse(mockQuery, 'no_match')
    const changes = { date: '2026-11-15', budget_kzt: 2000000 }
    response.alternatives = [
      {
        card: { ...mockCards[0], available_on: changes.date },
        changes,
        differences: [
          {
            field: 'date',
            requested: '14.11.2026',
            proposed: '15.11.2026',
            reason: 'На исходную дату занят',
          },
          {
            field: 'budget_kzt',
            requested: '1 500 000 ₸',
            proposed: '2 000 000 ₸',
            reason: 'Выше исходного бюджета',
          },
        ],
        explanation_mode: 'fallback',
      },
    ]
    response.suggestions.push(
      { label: 'Дубликат альтернативы', changes: { budget_kzt: 2000000, date: '2026-11-15' } },
      { label: 'Дубликат даты', changes: { date: '2026-11-15' } },
      { label: 'Пустое предложение', changes: {} },
    )
    const recommend = vi.fn().mockResolvedValue(response)
    await setup({ getOptions: async () => mockOptions, recommend })
    submit()
    const group = await screen.findByRole('region', { name: 'Варианты с изменением условий' })
    expect(within(group).getAllByRole('button')).toHaveLength(2)
    expect(screen.queryByText(/Дубликат|Пустое предложение/)).not.toBeInTheDocument()
    const dateSuggestion = within(group).getByRole('button', { name: /Проверить другую дату/ })
    expect(dateSuggestion).toHaveTextContent(/Дата: 14 ноября 2026 г. → 15 ноября 2026 г./)
    fireEvent.click(dateSuggestion)
    expect(document.getElementById('date')).toHaveValue(changes.date)
    expect(document.getElementById('budget_kzt')).toHaveValue(String(mockQuery.budget_kzt))
    expect(recommend).toHaveBeenCalledTimes(1)
  })
  it('does not render an empty alternatives section', async () => {
    const response = makeMockResponse(mockQuery, 'no_match')
    response.suggestions = [{ label: 'Нет изменений', changes: {} }]
    await setup({ getOptions: async () => mockOptions, recommend: async () => response })
    submit()
    await screen.findByRole('heading', { name: 'Кандидаты есть, условия не совпали' })
    expect(
      screen.queryByRole('region', { name: 'Варианты с изменением условий' }),
    ).not.toBeInTheDocument()
  })
})
