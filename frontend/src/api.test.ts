import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { makeMockResponse, mockQuery } from './mocks/fixtures'

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.useRealTimers()
})
describe('API transport', () => {
  it('sends the agreed JSON and explicit optional nulls', async () => {
    const query = { ...mockQuery, duration_hours: null, language: null }
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeMockResponse(query)), { status: 200 }),
    )
    await api.recommend(query, new AbortController().signal)
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/recommend')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual(query)
  })
  it('maps FastAPI 422 fields without exposing raw server messages', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: [{ loc: ['body', 'date'], msg: 'private server internals', type: 'value_error' }],
        }),
        { status: 422 },
      ),
    )
    await expect(api.recommend(mockQuery, new AbortController().signal)).rejects.toMatchObject({
      fields: { date: expect.stringContaining('дату') },
    })
  })
  it('turns server and malformed responses into errors, never mock matches', async () => {
    fetchMock.mockResolvedValueOnce(new Response('private secret', { status: 500 }))
    await expect(api.recommend(mockQuery, new AbortController().signal)).rejects.toThrow(
      'Сервис временно',
    )
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await expect(api.recommend(mockQuery, new AbortController().signal)).rejects.toThrow(
      'Не удалось прочитать',
    )
  })
  it('handles connection failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.getOptions(new AbortController().signal)).rejects.toThrow(
      'Не удалось связаться',
    )
  })
  it('times out without returning fake candidates', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    )
    const pending = expect(api.recommend(mockQuery, new AbortController().signal)).rejects.toThrow(
      'слишком много времени',
    )
    await vi.advanceTimersByTimeAsync(20_000)
    await pending
  })
})
