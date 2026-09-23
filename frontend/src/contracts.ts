import { z } from 'zod'
import type { components, paths } from './generated/api'

type ServerRecommendation =
  paths['/api/recommend']['post']['responses'][200]['content']['application/json']

const isoDate = z.iso.date()
export const querySchema = z.object({
  city: z.string().min(1),
  date: isoDate,
  event_type: z.string().min(1),
  category: z.string().min(1),
  budget_kzt: z.number().int().positive(),
  duration_hours: z.number().positive().nullable(),
  language: z.string().min(1).nullable(),
})
export const optionsSchema = z.object({
  cities: z.array(z.string()).min(1),
  categories: z.array(z.string()).min(1),
  event_types: z.array(z.string()).min(1),
  languages: z.array(z.string()),
  calendar: z.object({ min: isoDate, max: isoDate }),
  dataset: z.object({ version: z.string(), profiles_count: z.number().int().nonnegative() }),
})
export const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  categories: z.array(z.string()),
  city: z.string(),
  price_from_kzt: z.number().nonnegative(),
  languages: z.array(z.string()),
  max_hours: z.number().positive().nullable(),
  available_on: isoDate,
  description: z.string(),
  explanation: z.string(),
  evidence: z.array(z.object({ field: z.string(), value: z.string() })),
  synthetic: z.boolean(),
  price_imputed: z.boolean(),
  city_imputed: z.boolean(),
})
const alternativeChangesSchema = querySchema
  .pick({ date: true, budget_kzt: true, language: true, duration_hours: true })
  .partial()
  .strict()
  .refine(
    (changes) => Object.keys(changes).length > 0,
    'At least one changed condition is required',
  )
export const alternativeSchema = z
  .object({
    card: cardSchema,
    changes: alternativeChangesSchema,
    differences: z
      .array(
        z.object({
          field: z.enum(['date', 'budget_kzt', 'language', 'duration_hours']),
          requested: z.string().min(1),
          proposed: z.string().min(1),
          reason: z.string().min(1),
        }),
      )
      .min(1)
      .max(4),
    explanation_mode: z.literal('fallback'),
  })
  .refine(
    (value) => {
      const changed = Object.keys(value.changes)
      const described = value.differences.map((difference) => difference.field)
      return (
        changed.length > 0 &&
        changed.length === described.length &&
        new Set(described).size === described.length &&
        changed.every((key) => described.includes(key as (typeof described)[number]))
      )
    },
    { message: 'Every alternative change must be explained exactly once' },
  )
export const assessmentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(['selected', 'not_selected', 'excluded']),
    reasons: z.array(z.enum(['busy', 'budget', 'event_type', 'language', 'duration'])),
    rank: z.number().int().positive().nullable(),
  })
  .refine(
    (row) =>
      new Set(row.reasons).size === row.reasons.length &&
      (row.status === 'excluded'
        ? row.reasons.length > 0 && row.rank === null
        : row.reasons.length === 0 &&
          row.rank !== null &&
          row.rank <= 3 === (row.status === 'selected')),
  )

const recommendationBase = z.object({
  query: querySchema,
  total_in_category: z.number().int().nonnegative(),
  eligible_count: z.number().int().nonnegative(),
  cards: z.array(cardSchema).max(3),
  assessments: z.array(assessmentSchema),
  summary: z.string(),
  rejections: z.object({
    busy: z.number().int().nonnegative(),
    budget: z.number().int().nonnegative(),
    event_type: z.number().int().nonnegative(),
    language: z.number().int().nonnegative(),
    duration: z.number().int().nonnegative(),
  }),
  suggestions: z.array(z.object({ label: z.string(), changes: alternativeChangesSchema })),
  alternatives: z.array(alternativeSchema).max(3).optional(),
  meta: z.object({
    dataset_version: z.string(),
    explanation_mode: z.enum(['llm', 'fallback']),
    latency_ms: z.number().nonnegative(),
    ai: z
      .object({
        cache_hit: z.boolean(),
        shared_inflight: z.boolean(),
        quality_repaired: z.boolean(),
        fallback_reason: z
          .enum([
            'no_candidates',
            'not_configured',
            'circuit_open',
            'overloaded',
            'rate_limit',
            'session_budget',
            'timeout',
            'provider_http',
            'provider_network',
            'invalid_response',
          ])
          .nullable(),
        elapsed_ms: z.number().int().nonnegative(),
      })
      .optional(),
  }),
})

export const recommendationSchema = z
  .discriminatedUnion('status', [
    recommendationBase.extend({
      status: z.literal('matched'),
      cards: z.array(cardSchema).min(1).max(3),
    }),
    recommendationBase.extend({
      status: z.literal('no_match'),
      eligible_count: z.literal(0),
      cards: z.array(cardSchema).max(0),
    }),
    recommendationBase.extend({
      status: z.literal('no_category'),
      total_in_category: z.literal(0),
      eligible_count: z.literal(0),
      cards: z.array(cardSchema).max(0),
    }),
  ])
  .refine(
    (data) =>
      data.status === 'matched'
        ? data.eligible_count > 0 &&
          data.cards.length > 0 &&
          data.cards.length === Math.min(3, data.eligible_count)
        : data.eligible_count === 0 && data.cards.length === 0,
    { message: 'Inconsistent recommendation status' },
  )
  .refine(
    (data) => !(data.alternatives?.length || data.suggestions.length) || data.status === 'no_match',
    {
      message: 'Alternatives are only valid for no_match',
    },
  )
  .refine(
    (data) =>
      data.total_in_category >= data.eligible_count &&
      (data.status === 'no_category' ? data.total_in_category === 0 : data.total_in_category > 0) &&
      data.assessments.length === data.total_in_category &&
      new Set(data.assessments.map((row) => row.id)).size === data.assessments.length &&
      Object.entries(data.rejections).every(
        ([reason, count]) =>
          count ===
          data.assessments.filter((row) => row.reasons.some((value) => value === reason)).length,
      ),
    'Counts must agree with candidate assessments',
  )
  .refine((data) => {
    const eligible = data.assessments
      .filter((row) => row.rank !== null)
      .sort((a, b) => a.rank! - b.rank!)
    return (
      eligible.length === data.eligible_count &&
      eligible.every((row, index) => row.rank === index + 1) &&
      data.cards.every(
        (card, index) =>
          card.id === eligible[index]?.id &&
          card.city === data.query.city &&
          card.categories.includes(data.query.category) &&
          card.available_on === data.query.date &&
          card.price_from_kzt <= data.query.budget_kzt &&
          (!data.query.language || card.languages.includes(data.query.language)) &&
          (data.query.duration_hours === null ||
            card.max_hours === null ||
            data.query.duration_hours <= card.max_hours),
      )
    )
  }, 'Cards must match the declared query and first eligible ranks')
  .refine(
    (data) =>
      data.suggestions.every((suggestion) =>
        Object.entries(suggestion.changes).every(
          ([key, value]) => value !== data.query[key as keyof typeof suggestion.changes],
        ),
      ),
    'Suggestion must change its conditions',
  )
  .refine(
    (data) =>
      (data.alternatives ?? []).every(
        (alternative) =>
          alternative.card.city === data.query.city &&
          alternative.card.categories.includes(data.query.category) &&
          alternative.card.available_on === (alternative.changes.date ?? data.query.date) &&
          Object.entries(alternative.changes).every(
            ([key, value]) => value !== data.query[key as keyof typeof alternative.changes],
          ),
      ),
    { message: 'Alternative must preserve the requested service and identify actual changes' },
  ) satisfies z.ZodType<ServerRecommendation>

export type Options = components['schemas']['Options']
export type Query = Required<components['schemas']['Query']>
export type Contractor = components['schemas']['Card']
export type Recommendation = z.infer<typeof recommendationSchema>
export type Suggestion = Recommendation['suggestions'][number]
export type FieldName = keyof Query
export type FieldErrors = Partial<Record<FieldName, string>>
export type FormValues = Record<FieldName, string>
export const emptyForm: FormValues = {
  city: '',
  date: '',
  event_type: '',
  category: '',
  budget_kzt: '',
  duration_hours: '',
  language: '',
}
export const fieldLabels: Record<FieldName, string> = {
  city: 'Город',
  date: 'Дата',
  event_type: 'Тип мероприятия',
  category: 'Категория',
  budget_kzt: 'Бюджет',
  duration_hours: 'Длительность',
  language: 'Язык',
}
export function formToQuery(form: FormValues): Query {
  return {
    city: form.city,
    date: form.date,
    event_type: form.event_type,
    category: form.category,
    budget_kzt: Number(form.budget_kzt.replace(/\s/g, '')),
    duration_hours:
      form.duration_hours === '' ? null : Number(form.duration_hours.replace(',', '.')),
    language: form.language || null,
  }
}
export function queryToForm(query: Query): FormValues {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, value === null ? '' : String(value)]),
  ) as FormValues
}
export function validateForm(form: FormValues, options: Options): FieldErrors {
  const errors: FieldErrors = {}
  const q = formToQuery(form)
  if (!options.cities.includes(q.city)) errors.city = 'Выберите город из списка.'
  if (!options.categories.includes(q.category)) errors.category = 'Выберите категорию.'
  if (!options.event_types.includes(q.event_type)) errors.event_type = 'Выберите тип мероприятия.'
  if (!q.date) errors.date = 'Укажите дату мероприятия.'
  else if (
    !/^\d{4}-\d{2}-\d{2}$/.test(q.date) ||
    q.date < options.calendar.min ||
    q.date > options.calendar.max
  )
    errors.date = 'Выберите дату в доступном календаре.'
  if (!Number.isSafeInteger(q.budget_kzt) || q.budget_kzt <= 0)
    errors.budget_kzt = 'Введите целую сумму больше нуля.'
  if (q.duration_hours !== null && (!Number.isFinite(q.duration_hours) || q.duration_hours <= 0))
    errors.duration_hours = 'Введите число часов больше нуля.'
  if (q.language !== null && !options.languages.includes(q.language))
    errors.language = 'Выберите язык из списка.'
  return errors
}
export const formatMoney = (value: number) => new Intl.NumberFormat('ru-RU').format(value) + ' ₸'
export const formatDate = (value: string, year = false) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(year ? { year: 'numeric' as const } : {}),
  }).format(new Date(value + 'T12:00:00'))
export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
