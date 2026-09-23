import { z } from 'zod'
import { formatDate, type Options } from './contracts'

export const applicationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().min(1),
  categories: z.array(z.string()).min(1),
  event_formats: z.array(z.string()).min(1),
  languages: z.array(z.string()).min(1),
  price_from_kzt: z.number().int().min(1).max(1_000_000_000),
  max_hours: z.number().positive().max(24).nullable(),
  busy_dates: z.array(z.iso.date()).max(100),
  description: z.string().trim().min(30).max(3000),
  contact_email: z
    .string()
    .trim()
    .max(254)
    .regex(/^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/),
  synthetic: z.boolean(),
})
export type Application = z.infer<typeof applicationSchema>
export type ApplicationField = keyof Application
export type ApplicationErrors = Partial<Record<ApplicationField, string>>
export type ApplicationForm = Omit<Application, 'price_from_kzt' | 'max_hours' | 'busy_dates'> & {
  price_from_kzt: string
  max_hours: string
  busy_dates: string
}
export const blankApplication = (): ApplicationForm => ({
  name: '',
  city: '',
  categories: [],
  event_formats: [],
  languages: [],
  price_from_kzt: '',
  max_hours: '',
  busy_dates: '',
  description: '',
  contact_email: '',
  synthetic: false,
})
export const applicationMessages: Record<ApplicationField, string> = {
  name: 'Укажите имя или название: от 2 до 120 символов.',
  city: 'Выберите город из списка.',
  categories: 'Выберите хотя бы одну категорию.',
  event_formats: 'Выберите хотя бы один формат мероприятия.',
  languages: 'Выберите хотя бы один язык.',
  price_from_kzt: 'Цена должна быть целой: от 1 до 1 000 000 000 ₸.',
  max_hours:
    'Укажите число больше 0 и не больше 24. Пустое поле означает неприменимость длительности.',
  busy_dates: 'Укажите до 100 уникальных дат YYYY-MM-DD в доступном календаре.',
  description: 'Расскажите об услугах: от 30 до 3000 символов.',
  contact_email: 'Укажите корректный email, не больше 254 символов.',
  synthetic: 'Проверьте отметку тестовой анкеты.',
}
export function applicationPayload(form: ApplicationForm): Application {
  return {
    name: form.name.trim(),
    city: form.city,
    categories: form.categories,
    event_formats: form.event_formats,
    languages: form.languages,
    synthetic: form.synthetic,
    description: form.description.trim(),
    contact_email: form.contact_email.trim(),
    price_from_kzt: Number(form.price_from_kzt.replace(/\s/g, '')),
    max_hours: form.max_hours.trim() ? Number(form.max_hours.replace(',', '.')) : null,
    busy_dates: parseBusyDates(form.busy_dates),
  }
}
export function parseBusyDates(value: string): string[] {
  return value.trim() ? value.split(/[,;\s]+/).filter(Boolean) : []
}
export function busyDatesError(value: string, calendar: Options['calendar']): string | undefined {
  const dates = parseBusyDates(value)
  if (dates.length > 100) return 'Можно указать не больше 100 занятых дат.'
  if (dates.some((date) => !z.iso.date().safeParse(date).success))
    return (
      'Проверьте даты: нужен формат ГГГГ-ММ-ДД и существующий день, например ' + calendar.min + '.'
    )
  if (new Set(dates).size !== dates.length)
    return 'В списке есть повторяющиеся даты. Оставьте каждую дату один раз.'
  if (dates.some((date) => date < calendar.min || date > calendar.max))
    return (
      'Все занятые даты должны быть в диапазоне ' +
      formatDate(calendar.min, true) +
      ' — ' +
      formatDate(calendar.max, true) +
      '.'
    )
}
export function validateApplication(form: ApplicationForm, options: Options): ApplicationErrors {
  const payload = applicationPayload(form)
  const errors: ApplicationErrors = {}
  const parsed = applicationSchema.safeParse(payload)
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as ApplicationField
      errors[key] = applicationMessages[key]
    }
  if (!options.cities.includes(payload.city)) errors.city = applicationMessages.city
  const choices = {
    categories: options.categories,
    event_formats: options.event_types,
    languages: options.languages,
  }
  for (const key of ['categories', 'event_formats', 'languages'] as const) {
    if (
      new Set(payload[key]).size !== payload[key].length ||
      payload[key].some((value) => !choices[key].includes(value))
    )
      errors[key] = applicationMessages[key]
  }
  const calendarError = busyDatesError(form.busy_dates, options.calendar)
  if (calendarError) errors.busy_dates = calendarError
  for (const key of ['name', 'description', 'contact_email'] as const) {
    const invalid = [...payload[key]].some((char) => {
      const code = char.charCodeAt(0)
      return code === 127 || (code < 32 && !(key === 'description' && '\n\r\t'.includes(char)))
    })
    if (invalid) errors[key] = 'Удалите недопустимые управляющие символы из текста.'
  }
  return errors
}
export const profileSchema = applicationSchema.omit({ contact_email: true }).extend({
  name: z.string(),
  description: z.string(),
  categories: z.array(z.string()),
  event_formats: z.array(z.string()),
  languages: z.array(z.string()),
  contact_email: z.string().nullable(),
  id: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  source: z.enum(['dataset', 'application', 'admin']),
  revision: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
  moderation_note: z.string(),
  price_imputed: z.boolean(),
  city_imputed: z.boolean(),
})
export type Profile = z.infer<typeof profileSchema>
export const profileListSchema = z.object({
  items: z.array(profileSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  storage: z.literal('sqlite'),
  counts: z.object({
    pending: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
})
export type ProfileList = z.infer<typeof profileListSchema>
export type ProfileFilter = 'all' | Profile['status']
export const receiptSchema = z.object({
  id: z.string(),
  status: z.literal('pending'),
  message: z.string(),
})
export type Receipt = z.infer<typeof receiptSchema>
export class PlatformError extends Error {
  constructor(
    message: string,
    public status = 0,
    public fields: ApplicationErrors = {},
  ) {
    super(message)
    this.name = 'PlatformError'
  }
}
async function request<T>(
  path: string,
  schema: z.ZodType<T> | null,
  init: { token?: string; method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(path, {
      method: init.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
    })
    if (!response.ok) {
      const fields: ApplicationErrors = {}
      if (response.status === 422) {
        const body: unknown = await response.json().catch(() => null)
        const parsed = z
          .object({
            detail: z.array(z.object({ loc: z.array(z.union([z.string(), z.number()])) })),
          })
          .safeParse(body)
        if (parsed.success)
          for (const issue of parsed.data.detail) {
            const field = issue.loc.find(
              (part) => typeof part === 'string' && Object.hasOwn(applicationMessages, part),
            ) as ApplicationField | undefined
            if (field) fields[field] = applicationMessages[field]
          }
      }
      const message =
        (
          {
            401: 'Неверный токен администратора. Войдите снова.',
            403: 'Недостаточно прав для этого действия.',
            404: 'Анкета уже удалена. Обновите список.',
            409:
              path === '/api/applications'
                ? 'Такая анкета уже отправлена. Дождитесь решения администратора.'
                : 'Данные изменились или такая анкета уже существует. Обновите список перед повторным действием.',
            422: 'Проверьте отмеченные поля и повторите действие.',
            503: path.startsWith('/api/admin/')
              ? 'Панель пока недоступна: администратор должен настроить доступ на сервере.'
              : 'Приём анкет временно недоступен. Введённые данные сохранены на странице; попробуйте позже.',
          } as Record<number, string>
        )[response.status] || 'Сервис временно недоступен. Попробуйте ещё раз.'
      throw new PlatformError(message, response.status, fields)
    }
    if (!schema) return undefined as T
    const result = schema.safeParse(await response.json().catch(() => null))
    if (!result.success)
      throw new PlatformError('Не удалось прочитать ответ сервиса. Попробуйте обновить страницу.')
    return result.data
  } catch (error) {
    if (init.signal?.aborted) throw error
    if (error instanceof PlatformError) throw error
    throw new PlatformError(
      controller.signal.aborted
        ? 'Сервис отвечает слишком долго. Проверьте результат перед повторной отправкой.'
        : 'Не удалось связаться с сервисом. Проверьте соединение и повторите попытку.',
    )
  } finally {
    clearTimeout(timeout)
  }
}
export const platformApi = {
  apply: (body: Application, signal?: AbortSignal) =>
    request('/api/applications', receiptSchema, { method: 'POST', body, signal }),
  list: (token: string, status: ProfileFilter, offset = 0, signal?: AbortSignal) =>
    request(`/api/admin/profiles?status=${status}&limit=12&offset=${offset}`, profileListSchema, {
      token,
      signal,
    }),
  add: (token: string, body: Application, signal?: AbortSignal) =>
    request('/api/admin/profiles', profileSchema, { token, method: 'POST', body, signal }),
  moderate: (
    token: string,
    profile: Profile,
    decision: 'approved' | 'rejected',
    note: string,
    signal?: AbortSignal,
  ) =>
    request(`/api/admin/profiles/${encodeURIComponent(profile.id)}/moderate`, profileSchema, {
      token,
      method: 'POST',
      body: { decision, expected_revision: profile.revision, note: note.trim() },
      signal,
    }),
  remove: (token: string, profile: Profile, signal?: AbortSignal) =>
    request<void>(
      `/api/admin/profiles/${encodeURIComponent(profile.id)}?expected_revision=${profile.revision}`,
      null,
      { token, method: 'DELETE', signal },
    ),
}
