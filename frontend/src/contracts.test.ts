import { describe, it, expect } from 'vitest'
import {
  emptyForm,
  formToQuery,
  queryToForm,
  validateForm,
  recommendationSchema,
} from './contracts'
import { makeMockResponse, mockOptions, mockQuery } from './mocks/fixtures'

describe('API contract and form', () => {
  it('preserves optional nulls and empty preferences, with numeric budget and duration', () => {
    const form = {
      ...queryToForm(mockQuery),
      budget_kzt: '1 500 000',
      duration_hours: '',
      language: '',
    }
    expect(formToQuery(form)).toEqual({ ...mockQuery, duration_hours: null, language: null })
    expect(formToQuery({ ...form, duration_hours: '2,5' }).duration_hours).toBe(2.5)
  })
  it('validates all required fields before a request', () => {
    expect(Object.keys(validateForm(emptyForm, mockOptions))).toEqual([
      'city',
      'category',
      'event_type',
      'date',
      'budget_kzt',
    ])
  })
  it('uses the calendar and lists from options, including newly added categories', () => {
    const options = {
      ...mockOptions,
      categories: ['Новая категория'],
      calendar: { min: '2027-01-01', max: '2027-02-01' },
    }
    const form = { ...queryToForm(mockQuery), category: 'Новая категория', date: '2027-01-10' }
    expect(validateForm(form, options)).toEqual({})
    expect(validateForm({ ...form, date: '2026-11-14' }, options)).toHaveProperty('date')
  })
  it('rejects invalid numbers and unknown choices', () => {
    const invalid = {
      ...queryToForm(mockQuery),
      budget_kzt: 'Infinity',
      duration_hours: '0',
      language: 'unknown',
    }
    expect(validateForm(invalid, mockOptions)).toHaveProperty('budget_kzt')
    expect(validateForm(invalid, mockOptions)).toHaveProperty('duration_hours')
    expect(validateForm(invalid, mockOptions)).toHaveProperty('language')
    expect(validateForm({ ...invalid, budget_kzt: '2.5' }, mockOptions)).toHaveProperty(
      'budget_kzt',
    )
  })
  it('accepts valid partial results and null service duration', () => {
    const response = makeMockResponse(mockQuery, 'one')
    response.cards[0].max_hours = null
    expect(recommendationSchema.parse(response).cards[0].max_hours).toBeNull()
  })
  it('rejects inconsistent empty results and unknown statuses', () => {
    expect(
      recommendationSchema.safeParse({ ...makeMockResponse(), status: 'no_match' }).success,
    ).toBe(false)
    expect(recommendationSchema.safeParse({ ...makeMockResponse(), status: 'other' }).success).toBe(
      false,
    )
  })
  it('strips unknown suggestion fields so they cannot modify the form', () => {
    const result = recommendationSchema.parse({
      ...makeMockResponse(),
      suggestions: [{ label: 'Другая дата', changes: { date: '2026-12-01', api_key: 'hidden' } }],
    })
    expect(result.suggestions[0].changes).toEqual({ date: '2026-12-01' })
  })
})
