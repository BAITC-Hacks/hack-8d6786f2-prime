import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { ApiError, type Api } from './api'
import type { Recommendation } from './contracts'
import { makeMockResponse, mockOptions, mockQuery } from './mocks/fixtures'

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
})
