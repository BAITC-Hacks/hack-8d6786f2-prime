import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applicationPayload,
  blankApplication,
  platformApi,
  PlatformError,
  validateApplication,
} from './platform'
import { mockOptions } from './mocks/fixtures'

const valid = () => ({
  ...blankApplication(),
  name: '  Анна Тестовая  ',
  city: 'Алматы',
  categories: ['Ведущий'],
  event_formats: ['корпоратив'],
  languages: ['русский'],
  description: 'Провожу корпоративы с живой музыкой и интерактивной программой.',
  contact_email: 'ann@example.com',
  price_from_kzt: '250 000',
  max_hours: '6,5',
  busy_dates: '2026-11-14,\n2026-11-21',
})
afterEach(() => vi.unstubAllGlobals())
describe('contractor application validation', () => {
  it('normalizes valid inputs and retains null inapplicable hours', () => {
    expect(validateApplication(valid(), mockOptions)).toEqual({})
    expect(applicationPayload(valid())).toMatchObject({
      name: 'Анна Тестовая',
      price_from_kzt: 250000,
      max_hours: 6.5,
      busy_dates: ['2026-11-14', '2026-11-21'],
      synthetic: false,
    })
    expect(applicationPayload({ ...valid(), max_hours: '' }).max_hours).toBeNull()
  })
  it.each([
    '2026-11-14,2026-11-14',
    '2026-02-30',
    '2027-01-01',
    'tomorrow',
    Array(101).fill('2026-11-14').join(','),
  ])('rejects invalid or repeated busy dates: %s', (busy_dates) => {
    expect(validateApplication({ ...valid(), busy_dates }, mockOptions).busy_dates).toBeTruthy()
  })
  it('validates limits, email, required selections, and catalog membership', () => {
    expect(
      Object.keys(
        validateApplication(
          {
            ...valid(),
            name: 'a',
            description: 'short',
            contact_email: 'bad@',
            price_from_kzt: '1000000001',
            max_hours: '25',
            city: 'Unknown',
            categories: [],
            event_formats: ['unknown'],
            languages: ['русский', 'русский'],
          },
          mockOptions,
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        'name',
        'description',
        'contact_email',
        'price_from_kzt',
        'max_hours',
        'city',
        'categories',
        'event_formats',
        'languages',
      ]),
    )
  })
})
describe('platform API error handling', () => {
  it('maps a duplicate response without displaying a private server body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: 'private secret' }), { status: 409 }),
        ),
    )
    await expect(platformApi.apply(applicationPayload(valid()))).rejects.toThrow(
      'Такая анкета уже отправлена',
    )
  })
  it('sends admin credentials only in authorization header', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [],
            total: 0,
            offset: 0,
            limit: 12,
            counts: { pending: 0, approved: 0, rejected: 0 },
            storage: 'sqlite',
          }),
        ),
      )
    vi.stubGlobal('fetch', fetcher)
    await platformApi.list('test-only-token', 'pending')
    const [url, init] = fetcher.mock.calls[0]
    expect(url).not.toContain('test-only-token')
    expect(init.headers.Authorization).toBe('Bearer test-only-token')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
  it('returns safe field errors on 422', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ detail: [{ loc: ['body', 'contact_email'], input: 'PRIVATE' }] }),
            { status: 422 },
          ),
        ),
    )
    await expect(platformApi.apply(applicationPayload(valid()))).rejects.toMatchObject<
      Partial<PlatformError>
    >({ status: 422, fields: { contact_email: expect.stringContaining('email') } })
  })
})
