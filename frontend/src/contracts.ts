import { z } from 'zod'

const isoDate = z.iso.date()
export const querySchema = z.object({
  city: z.string().min(1),
  date: isoDate,
  event_type: z.string().min(1),
  category: z.string().min(1),
  budget_kzt: z.number().int().positive(),
  duration_hours: z.number().positive().nullable(),
  language: z.string().min(1).nullable(),
  preferences: z.string().max(500),
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
export const alternativeSchema = z.object({
  card: cardSchema,
  changes: querySchema
    .pick({ date: true, budget_kzt: true, language: true, duration_hours: true })
    .partial(),
  differences: z
    .array(
      z.object({
        field: z.enum(['date', 'budget_kzt', 'language', 'duration_hours']),
        requested: z.string(),
        proposed: z.string(),
        reason: z.string(),
      }),
    )
    .min(1),
  explanation_mode: z.enum(['llm', 'fallback']),
})
export const recommendationSchema = z
  .object({
    status: z.enum(['matched', 'no_category', 'no_match']),
    query: querySchema,
    total_in_category: z.number().int().nonnegative(),
    eligible_count: z.number().int().nonnegative(),
    cards: z.array(cardSchema),
    summary: z.string(),
    rejections: z.object({
      busy: z.number().int().nonnegative(),
      budget: z.number().int().nonnegative(),
      event_type: z.number().int().nonnegative(),
      language: z.number().int().nonnegative(),
      duration: z.number().int().nonnegative(),
    }),
    suggestions: z.array(z.object({ label: z.string(), changes: querySchema.partial() })),
    alternatives: z.array(alternativeSchema).max(3).optional(),
    meta: z.object({
      dataset_version: z.string(),
      explanation_mode: z.enum(['llm', 'fallback']),
      latency_ms: z.number().nonnegative(),
    }),
  })
  .refine(
    (data) =>
      data.status === 'matched'
        ? data.eligible_count > 0 &&
          data.cards.length > 0 &&
          data.cards.length <= data.eligible_count
        : data.eligible_count === 0 && data.cards.length === 0,
    { message: 'Inconsistent recommendation status' },
  )

export type Options = z.infer<typeof optionsSchema>
export type Query = z.infer<typeof querySchema>
export type Contractor = z.infer<typeof cardSchema>
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
  preferences: '',
}
export const fieldLabels: Record<FieldName, string> = {
  city: 'Город',
  date: 'Дата',
  event_type: 'Тип мероприятия',
  category: 'Категория',
  budget_kzt: 'Бюджет',
  duration_hours: 'Длительность',
  language: 'Язык',
  preferences: 'Пожелания',
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
    preferences: form.preferences.trim(),
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
  if (q.preferences.length > 500) errors.preferences = 'Не больше 500 символов.'
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
