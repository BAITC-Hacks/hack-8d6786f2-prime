import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, type Api } from './api'
import {
  emptyForm,
  fieldLabels,
  formToQuery,
  queryToForm,
  validateForm,
  type FieldErrors,
  type FieldName,
  type FormValues,
  type Options,
  type Query,
  type Recommendation,
  type Suggestion,
} from './contracts'
import { showCondition } from './components/conditions'

export function useRecommendation(client: Api) {
  const [options, setOptions] = useState<Options | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [optionsAttempt, setOptionsAttempt] = useState(0)
  const [form, setForm] = useState<FormValues>({ ...emptyForm })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [previous, setPrevious] = useState<Recommendation | null>(null)
  const lastResult = useRef<Recommendation | null>(null)
  const [result, setResult] = useState<Recommendation | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')
  const activeRequest = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const formRef = useRef<HTMLFormElement>(null)
  const resultsHeading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setOptionsError(null)
    const load = async () => {
      try {
        const next = await client.getOptions(controller.signal)
        if (!controller.signal.aborted) setOptions(next)
      } catch (error) {
        if (!controller.signal.aborted)
          setOptionsError(
            error instanceof ApiError ? error.message : 'Не удалось загрузить параметры подбора.',
          )
      }
    }
    void load()
    return () => controller.abort()
  }, [client, optionsAttempt])
  useEffect(
    () => () => {
      sequence.current++
      activeRequest.current?.abort()
    },
    [],
  )

  const invalidate = () => {
    sequence.current++
    activeRequest.current?.abort()
    activeRequest.current = null
    setLoading(false)
    setResult(null)
    setRequestError(null)
    setDirty(true)
  }
  const update = (name: FieldName, value: string) => {
    invalidate()
    setForm((old) => ({ ...old, [name]: value }))
    setErrors((old) => ({ ...old, [name]: undefined }))
    setNotice('')
  }
  const focusError = (fields: FieldErrors) => {
    const field = Array.from(
      formRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[name]') ?? [],
    ).find((element) => fields[element.name as FieldName])?.name
    if (field) formRef.current?.querySelector<HTMLElement>('[name="' + field + '"]')?.focus()
  }
  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!options || activeRequest.current) return
    const nextErrors = validateForm(form, options)
    setErrors(nextErrors)
    setNotice('')
    if (Object.keys(nextErrors).length) {
      focusError(nextErrors)
      return
    }
    const controller = new AbortController()
    activeRequest.current = controller
    const id = ++sequence.current
    setLoading(true)
    setResult(null)
    setRequestError(null)
    try {
      const query: Query = formToQuery(form)
      const next = await client.recommend(query, controller.signal)
      if (id !== sequence.current || controller.signal.aborted) return
      setPrevious(lastResult.current)
      lastResult.current = next
      setResult(next)
      setDirty(false)
      requestAnimationFrame(() => resultsHeading.current?.focus({ preventScroll: true }))
    } catch (error) {
      if (id !== sequence.current || controller.signal.aborted) return
      const failure =
        error instanceof ApiError
          ? error
          : new ApiError('Не удалось выполнить подбор. Повторите попытку.')
      setRequestError(failure.message)
      setErrors(failure.fields)
      if (Object.keys(failure.fields).length) focusError(failure.fields)
      else requestAnimationFrame(() => resultsHeading.current?.focus())
    } finally {
      if (id === sequence.current) {
        activeRequest.current = null
        setLoading(false)
      }
    }
  }
  const applySuggestion = (suggestion: Suggestion) => {
    invalidate()
    setForm((old) => queryToForm({ ...formToQuery(old), ...suggestion.changes }))
    setErrors({})
    setNotice(
      'Условия изменены: ' +
        Object.entries(suggestion.changes)
          .map(
            ([key, value]) =>
              fieldLabels[key as FieldName].toLowerCase() +
              ' — ' +
              showCondition(key as FieldName, value),
          )
          .join('; ') +
        '. Нажмите «Подобрать подрядчиков».',
    )
    requestAnimationFrame(() => {
      const first = Object.keys(suggestion.changes)[0]
      formRef.current?.querySelector<HTMLElement>('[name="' + first + '"]')?.focus()
    })
  }
  return {
    options,
    optionsError,
    setOptionsAttempt,
    form,
    errors,
    result,
    previous,
    requestError,
    loading,
    dirty,
    notice,
    formRef,
    resultsHeading,
    update,
    submit,
    applySuggestion,
  }
}
