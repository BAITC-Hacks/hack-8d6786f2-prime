import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight,
  Check,
  ClipboardList,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react'
import { capitalize, formatDate, formatMoney, type Options } from './contracts'
import {
  applicationPayload,
  blankApplication,
  busyDatesError,
  parseBusyDates,
  platformApi,
  PlatformError,
  validateApplication,
  type Application,
  type ApplicationErrors,
  type ApplicationField,
  type ApplicationForm,
  type Profile,
  type ProfileFilter,
  type ProfileList,
  type Receipt,
} from './platform'

export const statusLabels = { pending: 'На проверке', approved: 'Одобрена', rejected: 'Отклонена' }
const sourceLabels = {
  dataset: 'Исходный каталог',
  application: 'Публичная анкета',
  admin: 'Администратор',
}
function FormField({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: ApplicationField
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={'application-' + name}>{label}</label>
      {children}
      {hint && (
        <span id={'application-' + name + '-hint'} className="field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={'application-' + name + '-error'} className="field-error">
          {error}
        </span>
      )}
    </div>
  )
}
export function ContractorForm({
  options,
  onSubmit,
  direct = false,
  disabled = false,
}: {
  options: Options
  onSubmit: (payload: Application) => Promise<void>
  direct?: boolean
  disabled?: boolean
}) {
  const [form, setForm] = useState<ApplicationForm>(blankApplication)
  const [errors, setErrors] = useState<ApplicationErrors>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dateToAdd, setDateToAdd] = useState('')
  const [calendarError, setCalendarError] = useState('')
  const locked = useRef(false)
  const mounted = useRef(true)
  const element = useRef<HTMLFormElement>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const update = <K extends ApplicationField>(key: K, value: ApplicationForm[K]) => {
    setForm((old) => ({ ...old, [key]: value }))
    setErrors((old) => ({ ...old, [key]: undefined }))
    setError('')
  }
  const attrs = (
    name:
      | 'name'
      | 'city'
      | 'description'
      | 'contact_email'
      | 'price_from_kzt'
      | 'max_hours'
      | 'busy_dates',
  ) => ({
    id: 'application-' + name,
    name,
    value: form[name],
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': [
      name !== 'city' ? 'application-' + name + '-hint' : '',
      errors[name] ? 'application-' + name + '-error' : '',
    ]
      .filter(Boolean)
      .join(' '),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      update(name, e.target.value),
  })
  const focusFirst = (fields: ApplicationErrors) => {
    const first = Object.keys(fields)[0]
    element.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (locked.current || disabled) return
    const next = validateApplication(form, options)
    setErrors(next)
    setError('')
    if (Object.keys(next).length) {
      focusFirst(next)
      return
    }
    locked.current = true
    setBusy(true)
    let failedFields: ApplicationErrors = {}
    try {
      await onSubmit(applicationPayload(form))
    } catch (failure) {
      if (!mounted.current) return
      const apiError =
        failure instanceof PlatformError
          ? failure
          : new PlatformError('Не удалось отправить анкету. Попробуйте ещё раз.')
      setError(apiError.message)
      setErrors(apiError.fields)
      failedFields = apiError.fields
    } finally {
      locked.current = false
      if (mounted.current) {
        setBusy(false)
        requestAnimationFrame(() => {
          if (mounted.current) focusFirst(failedFields)
        })
      }
    }
  }
  const addBusyDate = () => {
    if (!dateToAdd) {
      setCalendarError('Выберите дату в календаре.')
      return
    }
    const dates = [...parseBusyDates(form.busy_dates), dateToAdd]
    const problem = busyDatesError(dates.join(', '), options.calendar)
    if (problem) {
      setCalendarError(problem)
      return
    }
    update('busy_dates', dates.join(', '))
    setCalendarError('')
    setDateToAdd('')
  }
  const busyDates = parseBusyDates(form.busy_dates)
  const validBusyDates = !busyDatesError(form.busy_dates, options.calendar)
  const multiselect = (
    key: 'categories' | 'event_formats' | 'languages',
    title: string,
    values: string[],
  ) => (
    <fieldset
      className="choice-field"
      aria-invalid={Boolean(errors[key])}
      aria-describedby={errors[key] ? `application-${key}-error` : undefined}
    >
      <legend>
        {title} <span>Можно несколько</span>
      </legend>
      <div className="choice-grid">
        {values.map((value) => (
          <label
            key={value}
            className={'choice-chip' + (form[key].includes(value) ? ' chosen' : '')}
          >
            <input
              type="checkbox"
              name={key}
              checked={form[key].includes(value)}
              onChange={(e) =>
                update(
                  key,
                  e.target.checked
                    ? [...form[key], value]
                    : form[key].filter((item) => item !== value),
                )
              }
            />
            {capitalize(value)}
          </label>
        ))}
      </div>
      {errors[key] && (
        <span className="field-error" id={`application-${key}-error`}>
          {errors[key]}
        </span>
      )}
    </fieldset>
  )
  return (
    <form
      id="contractor-application"
      ref={element}
      onSubmit={submit}
      noValidate
      className="application-form"
    >
      <fieldset disabled={busy || disabled} className="application-fields">
        <legend className="sr-only">Данные подрядчика</legend>
        <div className="form-section-title">
          <span>01</span>
          <h2>Знакомство</h2>
        </div>
        <FormField
          name="name"
          label="Имя или название команды"
          error={errors.name}
          hint="От 2 до 120 символов"
        >
          <input
            {...attrs('name')}
            autoComplete="off"
            maxLength={120}
            placeholder="Как вас представить заказчику?"
            required
          />
        </FormField>
        <div className="form-grid">
          <FormField name="city" label="Город работы" error={errors.city}>
            <select {...attrs('city')} required>
              <option value="">Выберите город</option>
              {options.cities.map((city) => (
                <option key={city}>{city}</option>
              ))}
            </select>
          </FormField>
          <FormField
            name="contact_email"
            label="Контактный email"
            error={errors.contact_email}
            hint="Виден только администратору"
          >
            <input
              {...attrs('contact_email')}
              type="email"
              autoComplete="off"
              maxLength={254}
              placeholder="name@example.com"
              required
            />
          </FormField>
        </div>
        {multiselect('categories', 'Категории услуг', options.categories)}
        {multiselect('event_formats', 'Форматы мероприятий', options.event_types)}
        {multiselect('languages', 'Языки работы', options.languages)}
        <div className="form-section-title">
          <span>02</span>
          <h2>Услуги и условия</h2>
        </div>
        <FormField
          name="description"
          label="Расскажите о своих услугах"
          error={errors.description}
          hint="30–3000 символов. Стиль, программа и особенности помогут заказчику выбрать вас."
        >
          <textarea
            {...attrs('description')}
            rows={5}
            maxLength={3000}
            required
            placeholder="Что вы делаете, для каких мероприятий и что отличает вашу работу?"
          />
          <span className="character-count">{form.description.trim().length}/3000</span>
        </FormField>
        <div className="form-grid">
          <FormField
            name="price_from_kzt"
            label="Стоимость от, ₸"
            error={errors.price_from_kzt}
            hint="За мероприятие, целое число"
          >
            <input
              {...attrs('price_from_kzt')}
              type="text"
              inputMode="numeric"
              placeholder="250 000"
              required
            />
          </FormField>
          <FormField
            name="max_hours"
            label="Максимальная длительность, ч"
            error={errors.max_hours}
            hint="До 24 часов. Пусто — длительность неприменима к услуге."
          >
            <input
              {...attrs('max_hours')}
              type="text"
              inputMode="decimal"
              placeholder="Например, 6"
            />
          </FormField>
        </div>
        <FormField
          name="busy_dates"
          label="Занятые даты"
          error={errors.busy_dates}
          hint={`Необязательно. До 100 дат YYYY-MM-DD через запятую или с новой строки. Календарь: ${formatDate(options.calendar.min, true)} — ${formatDate(options.calendar.max, true)}.`}
        >
          <div className="busy-date-picker">
            <div>
              <label htmlFor="busy-date-picker">Выбрать дату в календаре</label>
              <input
                id="busy-date-picker"
                type="date"
                min={options.calendar.min}
                max={options.calendar.max}
                value={dateToAdd}
                onChange={(e) => {
                  setDateToAdd(e.target.value)
                  setCalendarError('')
                }}
                aria-invalid={Boolean(calendarError)}
                aria-describedby={calendarError ? 'busy-date-picker-error' : undefined}
              />
            </div>
            <button type="button" className="secondary-button" onClick={addBusyDate}>
              Добавить дату
            </button>
          </div>
          {calendarError && (
            <p className="field-error" id="busy-date-picker-error" role="alert">
              {calendarError}
            </p>
          )}
          <textarea
            {...attrs('busy_dates')}
            rows={3}
            placeholder={options.calendar.min + ', ' + options.calendar.max}
          />
          {validBusyDates && busyDates.length > 0 && (
            <ul className="busy-date-tags" aria-label="Выбранные занятые даты">
              {busyDates.map((date) => (
                <li key={date}>
                  <span>{formatDate(date)}</span>
                  <button
                    type="button"
                    aria-label={'Убрать занятую дату ' + formatDate(date, true)}
                    onClick={() => {
                      update('busy_dates', busyDates.filter((value) => value !== date).join(', '))
                      setCalendarError('')
                    }}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FormField>
        <label className="synthetic-check">
          <input
            type="checkbox"
            checked={form.synthetic}
            onChange={(e) => update('synthetic', e.target.checked)}
          />
          <span>
            <b>Это вымышленная тестовая анкета</b>
            <small>
              Будет явно помечена в каталоге. Для реального подрядчика оставьте выключенным.
            </small>
          </span>
        </label>
        {Object.values(errors).some(Boolean) && (
          <p className="validation-summary" role="alert">
            Проверьте отмеченные поля анкеты.
          </p>
        )}
        {error && (
          <p className="platform-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : direct ? (
            <Plus size={18} />
          ) : (
            <ArrowRight size={18} />
          )}
          {busy ? 'Сохраняем анкету…' : direct ? 'Добавить в каталог' : 'Отправить на проверку'}
        </button>
        <p className="form-footnote">
          {direct
            ? 'Анкета сразу станет доступна для подбора.'
            : 'В подбор попадают только анкеты, одобренные администратором.'}
        </p>
      </fieldset>
    </form>
  )
}

function OptionsState({
  options,
  error,
  onRetry,
}: {
  options: Options | null
  error: string | null
  onRetry: () => void
}) {
  return !options ? (
    <div className="state-panel" role={error ? 'alert' : 'status'}>
      {error ? (
        <>
          <h2>Не удалось загрузить параметры</h2>
          <p>{error}</p>
          <button className="secondary-button" onClick={onRetry}>
            Повторить загрузку
          </button>
        </>
      ) : (
        <>
          <LoaderCircle className="spin" />
          <p>Загружаем параметры анкеты…</p>
        </>
      )}
    </div>
  ) : null
}
export function ApplicationPage({
  options,
  error,
  onRetry,
}: {
  options: Options | null
  error: string | null
  onRetry: () => void
}) {
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  return (
    <main id="platform-main" className="platform-main">
      <div className="platform-heading">
        <p className="eyebrow">СТАНЬТЕ ЧАСТЬЮ ХОРОШЕГО СОБЫТИЯ</p>
        <h1>
          Ваше дело.
          <br />
          <em>Новые возможности.</em>
        </h1>
        <p>
          Расскажите о себе. Мы проверим анкету, чтобы заказчики могли найти вас в подходящий
          момент.
        </p>
      </div>
      <div className="application-layout">
        <aside className="application-guide">
          <div className="state-icon">
            <UsersRound />
          </div>
          <h2>От анкеты до подбора</h2>
          <ol>
            <li>
              <b>Заполните профиль</b>
              <span>Услуги, стоимость и свободный календарь.</span>
            </li>
            <li>
              <b>Дождитесь проверки</b>
              <span>Администратор рассмотрит ваши данные.</span>
            </li>
            <li>
              <b>Появитесь в каталоге</b>
              <span>После одобрения вас увидят подходящие заказчики.</span>
            </li>
          </ol>
          <p>
            Пароль и платёжные данные не нужны. Контактный email доступен только администратору.
          </p>
        </aside>
        <section className="platform-panel" aria-label="Анкета подрядчика">
          {receipt ? (
            <div className="receipt" role="status">
              <div className="state-icon">
                <Check />
              </div>
              <span className="status-pill pending">На проверке</span>
              <h2>Анкета отправлена</h2>
              <p>{receipt.message}</p>
              <p className="receipt-id">
                Номер анкеты: <b>{receipt.id}</b>
              </p>
              <p>
                Сохраните номер для обращения к администратору. В каталоге анкета появится после
                одобрения.
              </p>
              <a className="secondary-button" href="#/">
                Перейти к подбору
              </a>
            </div>
          ) : options ? (
            <ContractorForm
              options={options}
              onSubmit={async (payload) => {
                const request = new AbortController()
                controller.current = request
                const result = await platformApi.apply(payload, request.signal)
                if (!request.signal.aborted && controller.current === request) setReceipt(result)
              }}
            />
          ) : (
            <OptionsState options={options} error={error} onRetry={onRetry} />
          )}
        </section>
      </div>
    </main>
  )
}

export function AdminPage({
  options,
  optionsError,
  onRetry,
}: {
  options: Options | null
  optionsError: string | null
  onRetry: () => void
}) {
  const [tokenInput, setTokenInput] = useState('')
  const [token, setToken] = useState('')
  const [list, setList] = useState<ProfileList | null>(null)
  const [filter, setFilter] = useState<ProfileFilter>('all')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<Profile | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null)
  const [revisionConflict, setRevisionConflict] = useState(false)
  const active = useRef<AbortController | null>(null)
  const lock = useRef(false)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const detailTitle = useRef<HTMLHeadingElement>(null)
  const session = useRef(0)
  useEffect(
    () => () => {
      session.current++
      active.current?.abort()
      active.current = null
    },
    [],
  )
  useEffect(() => {
    if (confirmDelete) deleteDialog.current?.showModal()
    else deleteDialog.current?.close()
  }, [confirmDelete])
  const logout = () => {
    session.current++
    active.current?.abort()
    active.current = null
    lock.current = false
    setToken('')
    setTokenInput('')
    setList(null)
    setSelected(null)
    setNote('')
    setNoteError('')
    setRevisionConflict(false)
    setConfirmDelete(null)
    setAdding(false)
    setBusy(false)
    setError('')
    setNotice('Вы вышли из панели. Токен удалён из памяти.')
    setFilter('all')
    setOffset(0)
  }
  const handleFailure = (failure: unknown) => {
    const problem =
      failure instanceof PlatformError
        ? failure
        : new PlatformError('Не удалось выполнить действие. Повторите попытку.')
    if (problem.status === 401 || problem.status === 403) {
      logout()
      setNotice('')
    }
    if (problem.status === 409 || problem.status === 404) setRevisionConflict(true)
    setError(problem.message)
  }
  const begin = () => {
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    active.current = new AbortController()
    return active.current
  }
  const isCurrent = (controller: AbortController) =>
    active.current === controller && !controller.signal.aborted
  const finish = (controller: AbortController) => {
    if (active.current === controller) {
      lock.current = false
      setBusy(false)
      active.current = null
    }
  }
  const load = async (
    nextToken = token,
    nextFilter = filter,
    nextOffset = offset,
    login = false,
  ) => {
    if (lock.current) return
    const controller = begin()
    try {
      let result = await platformApi.list(nextToken, nextFilter, nextOffset, controller.signal)
      if (!isCurrent(controller)) return
      if (nextOffset > 0 && result.items.length === 0) {
        const lastOffset =
          result.total > 0 ? Math.floor((result.total - 1) / result.limit) * result.limit : 0
        result = await platformApi.list(nextToken, nextFilter, lastOffset, controller.signal)
      }
      if (!isCurrent(controller)) return
      setList(result)
      setFilter(nextFilter)
      setOffset(result.offset)
      setSelected(null)
      setNote('')
      setNoteError('')
      setRevisionConflict(false)
      if (login) {
        setToken(nextToken)
        setTokenInput('')
      }
    } catch (failure) {
      if (isCurrent(controller)) handleFailure(failure)
    } finally {
      finish(controller)
    }
  }
  const mutate = async (
    action: (controller: AbortController) => Promise<unknown>,
    message: string,
  ) => {
    if (lock.current) return
    const controller = begin()
    try {
      await action(controller)
      if (!isCurrent(controller)) return
      setSelected(null)
      setConfirmDelete(null)
      setNote('')
      setNoteError('')
      setRevisionConflict(false)
      setList(null)
      setNotice(message)
      const result = await platformApi.list(token, filter, 0, controller.signal)
      if (!isCurrent(controller)) return
      setList(result)
      setOffset(0)
      setNotice(message)
    } catch (failure) {
      if (isCurrent(controller)) {
        setConfirmDelete(null)
        handleFailure(failure)
      }
    } finally {
      finish(controller)
    }
  }
  const moderate = (decision: 'approved' | 'rejected') => {
    if (!selected || revisionConflict || lock.current) return
    if (decision === 'rejected' && note.trim().length < 3) {
      setError('Укажите причину отклонения: не меньше 3 символов.')
      setNoteError('Для отклонения нужна причина от 3 до 500 символов.')
      document.getElementById('moderation-note')?.focus()
      return
    }
    void mutate(
      (controller) => platformApi.moderate(token, selected, decision, note, controller.signal),
      decision === 'approved'
        ? 'Анкета одобрена и доступна в подборе.'
        : 'Анкета отклонена и исключена из подбора.',
    )
  }
  return (
    <main id="platform-main" className="platform-main admin-main">
      <div className="platform-heading admin-heading">
        <div>
          <p className="eyebrow">КАЧЕСТВО КАТАЛОГА</p>
          <h1>Панель администратора</h1>
          <p>Анкеты, решения и актуальный состав каталога.</p>
        </div>
        {token && (
          <button className="secondary-button" onClick={logout}>
            Выйти из панели
          </button>
        )}
      </div>
      {!token ? (
        <section className="platform-panel admin-login">
          <div className="state-icon">
            <ShieldCheck />
          </div>
          <h2>Доступ для администратора</h2>
          <p>
            Используйте токен доступа, настроенный владельцем сервиса. Он хранится только до выхода,
            перехода в другой раздел или перезагрузки страницы.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (tokenInput.trim()) void load(tokenInput.trim(), 'all', 0, true)
            }}
          >
            <div className="field">
              <label htmlFor="admin-token">Токен администратора</label>
              <input
                id="admin-token"
                type="password"
                autoComplete="off"
                maxLength={512}
                spellCheck={false}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                required
                disabled={busy}
              />
            </div>
            {error && (
              <p className="platform-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="form-notice">
                {notice}
              </p>
            )}
            <button className="primary-button" disabled={busy || !tokenInput.trim()}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
              {busy ? 'Проверяем доступ…' : 'Войти в панель'}
            </button>
          </form>
        </section>
      ) : (
        <>
          <div className="admin-stats" aria-label="Статистика анкет">
            {(['pending', 'approved', 'rejected'] as const).map((status) => (
              <div key={status}>
                <span>{statusLabels[status]}</span>
                <b>{list?.counts[status] ?? '—'}</b>
              </div>
            ))}
          </div>
          <div className="admin-toolbar">
            <div className="field">
              <label htmlFor="profile-status">Статус анкет</label>
              <select
                id="profile-status"
                value={filter}
                disabled={busy}
                onChange={(e) => void load(token, e.target.value as ProfileFilter, 0)}
              >
                <option value="all">Все анкеты</option>
                <option value="pending">На проверке</option>
                <option value="approved">Одобренные</option>
                <option value="rejected">Отклонённые</option>
              </select>
            </div>
            <button className="secondary-button" disabled={busy} onClick={() => void load()}>
              Обновить список
            </button>
            <button
              className="primary-button compact"
              disabled={busy}
              onClick={() => {
                setAdding(!adding)
                setSelected(null)
                setError('')
                setNotice('')
              }}
            >
              <Plus size={17} />
              {adding ? 'Закрыть добавление' : 'Добавить подрядчика'}
            </button>
          </div>
          {error && (
            <div className="platform-error" role="alert">
              <p>{error}</p>
              {revisionConflict && (
                <p>
                  Действия с этой версией заблокированы. Нажмите «Обновить список» и откройте
                  актуальную анкету.
                </p>
              )}
            </div>
          )}
          {notice && (
            <p className="form-notice" role="status">
              {notice}
            </p>
          )}
          {adding && (
            <section className="platform-panel direct-add">
              <h2>Новый подрядчик</h2>
              <p className="section-intro">
                Вы добавляете проверенную анкету. После сохранения она сразу появится в подборе.
              </p>
              {options ? (
                <ContractorForm
                  options={options}
                  direct
                  disabled={busy}
                  onSubmit={async (payload) => {
                    if (lock.current) return
                    const controller = begin()
                    try {
                      await platformApi.add(token, payload, controller.signal)
                    } catch (failure) {
                      if (!isCurrent(controller)) return
                      if (
                        failure instanceof PlatformError &&
                        (failure.status === 401 || failure.status === 403)
                      )
                        handleFailure(failure)
                      finish(controller)
                      throw failure
                    }
                    if (!isCurrent(controller)) {
                      finish(controller)
                      return
                    }
                    setAdding(false)
                    setList(null)
                    setNotice('Подрядчик добавлен в каталог.')
                    try {
                      const result = await platformApi.list(token, filter, 0, controller.signal)
                      if (isCurrent(controller)) {
                        setList(result)
                        setOffset(0)
                      }
                    } catch (failure) {
                      if (isCurrent(controller)) handleFailure(failure)
                    } finally {
                      finish(controller)
                    }
                  }}
                />
              ) : (
                <OptionsState options={options} error={optionsError} onRetry={onRetry} />
              )}
            </section>
          )}
          <div className="admin-layout">
            <section
              className="platform-panel profile-list"
              aria-labelledby="profiles-title"
              aria-busy={busy}
            >
              <div className="list-heading">
                <h2 id="profiles-title">
                  Анкеты <span>{list?.total ?? '—'}</span>
                </h2>
                {busy && <LoaderCircle className="spin" size={18} aria-label="Обновление" />}
              </div>
              <p className="list-note">
                Все источники: исходный каталог, заявки и добавления администратора.
              </p>
              {list?.items.length ? (
                <ul>
                  {list.items.map((profile) => (
                    <li key={profile.id}>
                      <button
                        className={'profile-row' + (selected?.id === profile.id ? ' selected' : '')}
                        disabled={busy}
                        aria-label={'Открыть анкету ' + profile.name}
                        aria-pressed={selected?.id === profile.id}
                        onClick={() => {
                          setSelected(profile)
                          setNote(profile.moderation_note)
                          setNoteError('')
                          setAdding(false)
                          const currentSession = session.current
                          const focusOrigin = document.activeElement
                          requestAnimationFrame(() => {
                            if (
                              session.current === currentSession &&
                              document.activeElement === focusOrigin
                            )
                              detailTitle.current?.focus()
                          })
                        }}
                      >
                        <span className="profile-row-top">
                          <b>{profile.name}</b>
                          <span className={'status-pill ' + profile.status}>
                            {statusLabels[profile.status]}
                          </span>
                        </span>
                        <span>
                          {profile.categories.join(', ')} · {profile.city}
                        </span>
                        <span className="profile-row-bottom">
                          <small>{profile.id}</small>
                          <b>от {formatMoney(profile.price_from_kzt)}</b>
                        </span>
                        <span className="profile-row-meta">
                          <span>{sourceLabels[profile.source]}</span>
                          {profile.synthetic && <span>Вымышленный профиль</span>}
                          {(profile.price_imputed || profile.city_imputed) && (
                            <span>Данные дополнены</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : !list ? (
                <div className="list-empty" role="status">
                  {busy ? <LoaderCircle className="spin" /> : <ClipboardList />}
                  <h3>{busy ? 'Загружаем анкеты' : 'Список не загружен'}</h3>
                  <p>
                    {busy
                      ? 'Получаем актуальные данные каталога.'
                      : 'Нажмите «Обновить список», чтобы получить актуальные данные.'}
                  </p>
                </div>
              ) : (
                <div className="list-empty">
                  <ClipboardList />
                  <h3>Здесь пока нет анкет</h3>
                  <p>Выберите другой статус или добавьте подрядчика.</p>
                </div>
              )}
              {list && (
                <div className="pagination">
                  <button
                    className="secondary-button"
                    disabled={busy || offset === 0}
                    onClick={() => void load(token, filter, Math.max(0, offset - list.limit))}
                  >
                    Назад
                  </button>
                  <span>
                    {list.total
                      ? `${offset + 1}–${Math.min(offset + list.items.length, list.total)} из ${list.total}`
                      : '0 анкет'}
                  </span>
                  <button
                    className="secondary-button"
                    disabled={busy || offset + list.limit >= list.total}
                    onClick={() => void load(token, filter, offset + list.limit)}
                  >
                    Далее
                  </button>
                </div>
              )}
            </section>
            <section className="platform-panel profile-detail" aria-label="Данные анкеты">
              {selected ? (
                <>
                  <div className="detail-heading">
                    <span className={'status-pill ' + selected.status}>
                      {statusLabels[selected.status]}
                    </span>
                    <span>
                      {selected.id} · версия {selected.revision}
                    </span>
                  </div>
                  <h2 ref={detailTitle} tabIndex={-1}>
                    {selected.name}
                  </h2>
                  <p className="detail-description">{selected.description}</p>
                  <dl>
                    <dt>Город</dt>
                    <dd>{selected.city}</dd>
                    <dt>Категории</dt>
                    <dd>{selected.categories.join(', ')}</dd>
                    <dt>Мероприятия</dt>
                    <dd>{selected.event_formats.join(', ') || 'Не указаны'}</dd>
                    <dt>Языки</dt>
                    <dd>{selected.languages.join(', ') || 'Не указаны'}</dd>
                    <dt>Стоимость</dt>
                    <dd>от {formatMoney(selected.price_from_kzt)} за мероприятие</dd>
                    <dt>Длительность</dt>
                    <dd>
                      {selected.max_hours === null
                        ? 'Не применяется'
                        : `До ${selected.max_hours} ч`}
                    </dd>
                    <dt>Контактный email</dt>
                    <dd>{selected.contact_email || 'Не указан в исходном каталоге'}</dd>
                    <dt>Источник</dt>
                    <dd>{sourceLabels[selected.source]}</dd>
                    <dt>Создана</dt>
                    <dd>{new Date(selected.created_at).toLocaleString('ru-RU')}</dd>
                    <dt>Обновлена</dt>
                    <dd>{new Date(selected.updated_at).toLocaleString('ru-RU')}</dd>
                  </dl>
                  <div className="data-badges">
                    {selected.synthetic && <span className="data-badge">Вымышленный профиль</span>}
                    {selected.price_imputed && <span className="data-badge">Цена дополнена</span>}
                    {selected.city_imputed && <span className="data-badge">Город дополнен</span>}
                  </div>
                  <details className="busy-details">
                    <summary>Занятые даты ({selected.busy_dates.length})</summary>
                    <p>
                      {selected.busy_dates.length
                        ? selected.busy_dates.map((date) => formatDate(date, true)).join(' · ')
                        : 'Занятые даты не указаны'}
                    </p>
                  </details>
                  <div className="moderation-controls">
                    <div className="field">
                      <label htmlFor="moderation-note">Комментарий администратора</label>
                      <textarea
                        id="moderation-note"
                        rows={3}
                        maxLength={500}
                        value={note}
                        onChange={(e) => {
                          setNote(e.target.value)
                          setNoteError('')
                        }}
                        disabled={busy || revisionConflict}
                        aria-invalid={Boolean(noteError)}
                        aria-describedby={
                          noteError
                            ? 'moderation-note-hint moderation-note-error'
                            : 'moderation-note-hint'
                        }
                      />
                      <span id="moderation-note-hint" className="field-hint">
                        Для отклонения обязательна причина от 3 до 500 символов.
                      </span>
                      {noteError && (
                        <span className="field-error" id="moderation-note-error">
                          {noteError}
                        </span>
                      )}
                    </div>
                    <div className="moderation-actions">
                      <button
                        className="primary-button compact"
                        disabled={busy || revisionConflict || selected.status === 'approved'}
                        onClick={() => moderate('approved')}
                      >
                        <Check size={17} />
                        Одобрить анкету
                      </button>
                      <button
                        className="secondary-button"
                        disabled={busy || revisionConflict || selected.status === 'rejected'}
                        onClick={() => moderate('rejected')}
                      >
                        Отклонить анкету
                      </button>
                    </div>
                    <button
                      className="danger-button"
                      disabled={busy || revisionConflict}
                      onClick={() => setConfirmDelete(selected)}
                    >
                      <Trash2 size={16} />
                      Удалить анкету
                    </button>
                  </div>
                </>
              ) : (
                <div className="detail-placeholder">
                  <ClipboardList size={35} />
                  <h2>Выберите анкету</h2>
                  <p>
                    Здесь появятся полные данные и действия администратора. Пароли подрядчиков не
                    собираются.
                  </p>
                </div>
              )}
            </section>
          </div>
        </>
      )}
      <dialog
        ref={deleteDialog}
        className="how-dialog delete-dialog"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
        onCancel={(event) => {
          if (busy) event.preventDefault()
          else setConfirmDelete(null)
        }}
      >
        <h2 id="delete-title">Удалить анкету?</h2>
        <p id="delete-description">
          «{confirmDelete?.name}» будет удалена из каталога вместе с данными анкеты. Это действие
          нельзя отменить.
        </p>
        <div className="moderation-actions">
          <button
            className="secondary-button"
            autoFocus
            disabled={busy}
            onClick={() => setConfirmDelete(null)}
          >
            Отмена
          </button>
          <button
            className="danger-button solid"
            disabled={busy}
            onClick={() => {
              if (confirmDelete)
                void mutate(
                  (controller) => platformApi.remove(token, confirmDelete, controller.signal),
                  'Анкета удалена из каталога.',
                )
            }}
          >
            {busy ? 'Удаляем…' : 'Удалить навсегда'}
          </button>
        </div>
      </dialog>
    </main>
  )
}
