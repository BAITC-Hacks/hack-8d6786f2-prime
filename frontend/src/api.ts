import { z } from 'zod'
import {
  optionsSchema,
  recommendationSchema,
  type FieldErrors,
  type FieldName,
  type Query,
} from './contracts'

export class ApiError extends Error {
  fields: FieldErrors
  constructor(message: string, fields: FieldErrors = {}) {
    super(message)
    this.name = 'ApiError'
    this.fields = fields
  }
}

const validationBody = z.object({
  detail: z.array(
    z.object({ loc: z.array(z.union([z.string(), z.number()])), type: z.string().optional() }),
  ),
})
const messages: FieldErrors = {
  city: 'Проверьте выбранный город.',
  date: 'Проверьте дату: она должна входить в доступный календарь.',
  event_type: 'Проверьте тип мероприятия.',
  category: 'Проверьте категорию.',
  budget_kzt: 'Укажите положительный бюджет в целых тенге.',
  duration_hours: 'Укажите длительность больше нуля или оставьте поле пустым.',
  language: 'Выберите язык из списка или оставьте без ограничений.',
  preferences: 'Сократите пожелания до 500 символов.',
}
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  body?: Query,
): Promise<T> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), 20_000)
  try {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([signal, timeout.signal]),
    })
    if (response.status === 422) {
      const details = validationBody.safeParse(await response.json().catch(() => null))
      const fields: FieldErrors = {}
      if (details.success)
        for (const item of details.data.detail) {
          const key = item.loc.find(
            (value) => typeof value === 'string' && Object.hasOwn(messages, value),
          ) as FieldName | undefined
          if (key) fields[key] = messages[key]
        }
      throw new ApiError('Проверьте условия мероприятия и попробуйте ещё раз.', fields)
    }
    if (!response.ok)
      throw new ApiError('Сервис временно не отвечает. Попробуйте ещё раз чуть позже.')
    const parsed = schema.safeParse(await response.json().catch(() => null))
    if (!parsed.success)
      throw new ApiError('Не удалось прочитать ответ сервиса. Попробуйте ещё раз.')
    return parsed.data
  } catch (error) {
    if (signal.aborted) throw error
    if (timeout.signal.aborted)
      throw new ApiError('Ответ занимает слишком много времени. Попробуйте ещё раз.')
    if (error instanceof ApiError) throw error
    throw new ApiError('Не удалось связаться с сервисом. Проверьте соединение и повторите попытку.')
  } finally {
    clearTimeout(timer)
  }
}
export const api = {
  getOptions: (signal: AbortSignal) => request('/api/options', optionsSchema, signal),
  recommend: (query: Query, signal: AbortSignal) =>
    request('/api/recommend', recommendationSchema, signal, query),
}
export type Api = typeof api
