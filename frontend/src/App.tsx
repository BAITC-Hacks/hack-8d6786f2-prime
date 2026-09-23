import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Asterisk,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Globe2,
  Info,
  LoaderCircle,
  MapPin,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react'
import { api, ApiError, type Api } from './api'
import {
  capitalize,
  emptyForm,
  fieldLabels,
  formToQuery,
  formatDate,
  formatMoney,
  queryToForm,
  validateForm,
  type Contractor,
  type FieldErrors,
  type FieldName,
  type FormValues,
  type Options,
  type Query,
  type Recommendation,
  type Suggestion,
} from './contracts'
import type { Scenario } from './mocks/fixtures'

const isDemo = import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true'
const scenarios: { value: Scenario; label: string }[] = [
  { value: 'matched', label: 'Три результата' },
  { value: 'one', label: 'Один результат' },
  { value: 'two', label: 'Два результата' },
  { value: 'no_category', label: 'Нет категории' },
  { value: 'no_match', label: 'Нет совпадений' },
  { value: 'fallback', label: 'Базовые объяснения' },
  { value: 'error', label: 'Ошибка сервиса' },
  { value: 'validation', label: 'Ошибка полей' },
]
function Field({
  name,
  label,
  optional,
  error,
  hint,
  children,
}: {
  name: FieldName
  label: string
  optional?: boolean
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={name}>
        {label}
        {optional && <span className="optional"> · необязательно</span>}
      </label>
      {children}
      {hint && (
        <span className="field-hint" id={name + '-hint'}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={name + '-error'}>
          {error}
        </span>
      )}
    </div>
  )
}
function ContractorCard({ card, index }: { card: Contractor; index: number }) {
  const initials = card.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
  return (
    <article className="contractor-card" aria-labelledby={'card-' + index}>
      <div className="card-top">
        <div className={'avatar avatar-' + index} aria-hidden="true">
          {initials}
        </div>
        <div className="card-identity">
          <h3 id={'card-' + index}>{card.name}</h3>
          <p>
            {card.categories.join(', ')} <span aria-hidden="true">·</span> {card.city}
          </p>
        </div>
        <div className="card-price">
          <span>от {formatMoney(card.price_from_kzt)}</span>
          <small>за мероприятие</small>
        </div>
      </div>
      <div className="facts">
        <span className="available">
          <Check size={14} aria-hidden="true" />
          Доступен {formatDate(card.available_on)}
        </span>
        {card.languages.length > 0 && (
          <span>
            <Globe2 size={14} aria-hidden="true" />
            {card.languages.map(capitalize).join(', ')}
          </span>
        )}
        {card.max_hours !== null && (
          <span>
            <Clock3 size={14} aria-hidden="true" />
            До {card.max_hours} ч
          </span>
        )}
      </div>
      <div className="explanation">
        <h4>
          <Sparkles size={14} aria-hidden="true" />
          Почему подходит
        </h4>
        <p>{card.explanation || 'Объяснение не предоставлено.'}</p>
      </div>
      <div className="card-bottom">
        <details className="contractor-details">
          <summary>
            Подробнее о подрядчике <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="description">
            <p>{card.description || 'Дополнительное описание не указано.'}</p>
            {card.max_hours === null && (
              <p className="data-note">Для этой услуги длительность присутствия не применяется.</p>
            )}
            {card.price_imputed && (
              <p className="data-note">
                <Info size={14} aria-hidden="true" />
                Цена заполнена при подготовке каталога. Уточните стоимость у подрядчика.
              </p>
            )}
            {card.city_imputed && (
              <p className="data-note">
                <Info size={14} aria-hidden="true" />
                Город заполнен при подготовке каталога. Уточните место работы у подрядчика.
              </p>
            )}
          </div>
        </details>
        <div className="data-badges">
          {card.synthetic && <span className="data-badge">Вымышленный профиль</span>}
          {(card.price_imputed || card.city_imputed) && (
            <span className="data-badge subtle">Есть уточнения в описании</span>
          )}
        </div>
      </div>
    </article>
  )
}
function SuggestionChanges({ changes }: { changes: Suggestion['changes'] }) {
  return (
    <span className="suggestion-changes">
      {Object.entries(changes)
        .map(([key, value]) => {
          const field = key as FieldName
          const shown =
            value === null || value === ''
              ? 'без ограничений'
              : field === 'date'
                ? formatDate(String(value), true)
                : field === 'budget_kzt'
                  ? formatMoney(Number(value))
                  : field === 'duration_hours'
                    ? value + ' ч'
                    : String(value)
          return fieldLabels[field] + ': ' + shown
        })
        .join(' · ')}
    </span>
  )
}
function Results({
  result,
  loading,
  error,
  dirty,
  onSuggestion,
  onRetry,
  headingRef,
}: {
  result: Recommendation | null
  loading: boolean
  error: string | null
  dirty: boolean
  onSuggestion: (s: Suggestion) => void
  onRetry: () => void
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  const cards = result?.cards.slice(0, 3) ?? []
  return (
    <section className="results" aria-labelledby="results-title" aria-busy={loading}>
      <div className="results-heading">
        <div>
          <p className="section-kicker">
            <span>02</span>Подходящие люди
          </p>
          <h2 id="results-title" tabIndex={-1} ref={headingRef}>
            {loading ? 'Ищем совпадения' : result ? 'Результаты подбора' : 'Ваша команда — здесь'}
          </h2>
        </div>
        {result?.status === 'matched' && (
          <span className="count-pill">
            Показано {cards.length} из {result.eligible_count}
          </span>
        )}
      </div>
      <div className="result-announcement" role="status" aria-live="polite">
        {loading ? (
          <p>Проверяем условия и готовим объяснения…</p>
        ) : result ? (
          <p>{result.summary}</p>
        ) : null}
      </div>
      {loading ? (
        <div className="skeletons" aria-hidden="true">
          {[0, 1, 2].map((n) => (
            <div className="skeleton-card" key={n}>
              <div className="skeleton-line short" />
              <div className="skeleton-line" />
              <div className="skeleton-block" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="state-panel error-panel" role="alert">
          <div className="state-icon">
            <Info />
          </div>
          <h3>Подбор пока не завершён</h3>
          <p>{error}</p>
          <button className="secondary-button" onClick={onRetry}>
            <RotateCcw size={16} />
            Повторить подбор
          </button>
        </div>
      ) : result ? (
        <>
          <div className="query-chips" aria-label="Условия этого подбора">
            <span>
              <MapPin size={12} aria-hidden="true" />
              {result.query.city}
            </span>
            <span>
              <CalendarDays size={12} aria-hidden="true" />
              {formatDate(result.query.date)}
            </span>
            <span>до {formatMoney(result.query.budget_kzt)}</span>
          </div>
          {result.status === 'matched' ? (
            <>
              {result.meta.explanation_mode === 'fallback' && (
                <p className="fallback-note">
                  <Info size={15} aria-hidden="true" />
                  Базовые объяснения по данным каталога.
                </p>
              )}
              <div className="cards">
                {cards.map((card, index) => (
                  <ContractorCard card={card} index={index} key={card.id} />
                ))}
              </div>
              <p className="results-footnote">
                <Info size={14} aria-hidden="true" />
                Цены указаны «от». Итоговую стоимость и детали согласуйте с подрядчиком.
              </p>
            </>
          ) : (
            <div className="state-panel empty-panel">
              <div className="state-icon">
                {result.status === 'no_category' ? <MapPin /> : <SlidersHorizontal />}
              </div>
              <h3>
                {result.status === 'no_category'
                  ? 'В этом городе пока нет такой категории'
                  : 'Пока нет точного совпадения'}
              </h3>
              <p>
                {result.status === 'no_category'
                  ? 'Попробуйте выбрать другой город или категорию подрядчика.'
                  : 'Подрядчики есть, но сочетание даты, бюджета и других условий ограничивает выбор. Попробуйте изменить условия.'}
              </p>
              {result.status === 'no_match' && (
                <div className="rejections" aria-label="Причины исключения">
                  {Object.entries(result.rejections)
                    .filter(([, n]) => n > 0)
                    .map(([key, n]) => (
                      <span key={key}>
                        {
                          {
                            busy: 'Заняты на дату',
                            budget: 'Выше бюджета',
                            event_type: 'Другой тип события',
                            language: 'Другой язык',
                            duration: 'Не подходит длительность',
                          }[key]
                        }
                        : {n}
                      </span>
                    ))}
                </div>
              )}
            </div>
          )}
          {result.suggestions.length > 0 && (
            <div className="suggestions">
              <h3>Можно попробовать иначе</h3>
              <p>Нажатие изменит указанные поля. Затем запустите подбор.</p>
              {result.suggestions
                .filter((s) => Object.keys(s.changes).length > 0)
                .map((s, index) => (
                  <button key={index} className="suggestion" onClick={() => onSuggestion(s)}>
                    <span>
                      <b>{s.label}</b>
                      <SuggestionChanges changes={s.changes} />
                    </span>
                    <ArrowUpRight size={18} aria-hidden="true" />
                  </button>
                ))}
            </div>
          )}
        </>
      ) : (
        <div className="state-panel initial-panel">
          <div className="empty-art" aria-hidden="true">
            <div className="mini-card mini-back">
              <span />
              <i />
            </div>
            <div className="mini-card mini-front">
              <span>
                <UsersRound size={21} />
              </span>
              <div>
                <i />
                <i />
              </div>
              <b>
                <Check size={16} />
              </b>
            </div>
            <div className="art-star">
              <Asterisk size={29} />
            </div>
          </div>
          <div className="eyebrow">НЕ ПРОСТО СПИСОК ИМЁН</div>
          <h3>{dirty ? 'Обновим подбор под ваши планы' : 'Те, кто подойдёт именно вам'}</h3>
          <p>
            {dirty
              ? 'Условия изменены. Нажмите «Подобрать подрядчиков», чтобы получить актуальные результаты.'
              : 'Заполните детали события — здесь появятся до трёх подрядчиков с объяснением для каждого.'}
          </p>
          <div className="initial-points">
            <span>
              <Check size={15} />В рамках бюджета
            </span>
            <span>
              <Check size={15} />
              На нужную дату
            </span>
            <span>
              <Check size={15} />С понятным обоснованием
            </span>
          </div>
        </div>
      )}
    </section>
  )
}

export default function App({ client = api }: { client?: Api }) {
  const [options, setOptions] = useState<Options | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [optionsAttempt, setOptionsAttempt] = useState(0)
  const [form, setForm] = useState<FormValues>({ ...emptyForm })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [result, setResult] = useState<Recommendation | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')
  const [scenario, setScenario] = useState<Scenario>('matched')
  const activeRequest = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const formRef = useRef<HTMLFormElement>(null)
  const resultsHeading = useRef<HTMLHeadingElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setOptionsError(null)
    const load = async () => {
      try {
        if (isDemo) {
          const mock = await import('./mocks/fixtures')
          if (!controller.signal.aborted) {
            setOptions(mock.mockOptions)
            setForm(queryToForm(mock.mockQuery))
          }
        } else {
          const next = await client.getOptions(controller.signal)
          if (!controller.signal.aborted) setOptions(next)
        }
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
    const field = Object.keys(fields)[0]
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
      const next = isDemo
        ? await (await import('./mocks/fixtures')).mockRecommend(query, scenario, controller.signal)
        : await client.recommend(query, controller.signal)
      if (id !== sequence.current || controller.signal.aborted) return
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
        Object.keys(suggestion.changes)
          .map((key) => fieldLabels[key as FieldName].toLowerCase())
          .join(', ') +
        '. Нажмите «Подобрать подрядчиков».',
    )
    requestAnimationFrame(() => {
      const first = Object.keys(suggestion.changes)[0]
      formRef.current?.querySelector<HTMLElement>('[name="' + first + '"]')?.focus()
    })
  }
  const attrs = (name: FieldName, hasHint = false) => ({
    id: name,
    name,
    value: form[name],
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby':
      [hasHint ? name + '-hint' : '', errors[name] ? name + '-error' : '']
        .filter(Boolean)
        .join(' ') || undefined,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
    ) => update(name, event.target.value),
  })
  const select = (name: FieldName, values: string[], placeholder: string, optional = false) => (
    <div className="select-wrap">
      <select {...attrs(name)} required={!optional}>
        <option value="">{placeholder}</option>
        {values.map((value) => (
          <option key={value} value={value}>
            {capitalize(value)}
          </option>
        ))}
      </select>
      <ChevronDown size={15} aria-hidden="true" />
    </div>
  )

  return (
    <>
      <a href="#event-form" className="skip-link">
        Перейти к подбору
      </a>
      {isDemo && (
        <div className="demo-toolbar">
          <span>
            <b>Демонстрация.</b> Вымышленные примеры, без реального подбора.
          </span>
          <label htmlFor="scenario">Сценарий</label>
          <select
            id="scenario"
            value={scenario}
            onChange={(e) => {
              invalidate()
              setScenario(e.target.value as Scenario)
            }}
          >
            {scenarios.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#top" aria-label="сәт — главная">
            <span>
              <Asterisk size={27} strokeWidth={2} />
            </span>
            сәт<span className="brand-dot">.</span>
          </a>
          <nav aria-label="Основная навигация">
            <a className="active-nav" href="#event-form">
              Подбор подрядчиков
            </a>
            <button onClick={() => dialog.current?.showModal()}>
              Как это работает
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </nav>
          <span className="header-mark">Создано для ваших событий</span>
        </div>
      </header>
      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div>
            <p className="eyebrow">
              <span />
              ЛЮДИ, С КОТОРЫМИ ВСЁ СЛОЖИТСЯ
            </p>
            <h1 id="hero-title">
              Ваше событие.
              <br />
              <em>Подходящие люди.</em>
            </h1>
            <p className="hero-copy">
              Расскажите о планах — найдём подрядчиков
              <br className="desktop-break" /> и объясним, почему они вам подходят.
            </p>
          </div>
          <div className="hero-aside" aria-hidden="true">
            <div className="orbital-line" />
            <div className="event-seal">
              <Asterisk size={24} />
              <span>Меньше поиска.</span>
              <b>
                Больше
                <br />
                совпадений.
              </b>
              <span className="seal-line" />
            </div>
            <span className="floating-star">✳</span>
          </div>
        </section>
        <div className="workspace">
          <aside className="form-panel">
            <div className="panel-heading">
              <p className="section-kicker">
                <span>01</span>Детали мероприятия
              </p>
              <h2>О вашем событии</h2>
              <p>Начнём с того, что для вас важно.</p>
            </div>
            {optionsError && (
              <div className="options-error" role="alert">
                <Info size={18} />
                <p>{optionsError}</p>
                <button className="text-button" onClick={() => setOptionsAttempt((n) => n + 1)}>
                  Повторить загрузку
                </button>
              </div>
            )}
            {!options && !optionsError && (
              <p className="options-loading" role="status">
                <LoaderCircle className="spin" size={17} />
                Загружаем параметры…
              </p>
            )}
            <form id="event-form" ref={formRef} onSubmit={submit} noValidate>
              <fieldset disabled={!options}>
                <legend className="sr-only">Условия подбора подрядчиков</legend>
                <div className="form-grid">
                  <Field name="city" label="Город" error={errors.city}>
                    {select('city', options?.cities ?? [], 'Выберите город')}
                  </Field>
                  <Field name="date" label="Дата" error={errors.date}>
                    <input
                      type="date"
                      required
                      min={options?.calendar.min}
                      max={options?.calendar.max}
                      {...attrs('date')}
                    />
                  </Field>
                </div>
                {options && (
                  <p className="calendar-note">
                    Календарь: {formatDate(options.calendar.min)} —{' '}
                    {formatDate(options.calendar.max, true)}
                  </p>
                )}
                <Field name="event_type" label="Тип мероприятия" error={errors.event_type}>
                  {select('event_type', options?.event_types ?? [], 'Какое событие планируете?')}
                </Field>
                <Field name="category" label="Кого ищем?" error={errors.category}>
                  {select('category', options?.categories ?? [], 'Выберите категорию')}
                </Field>
                <Field
                  name="budget_kzt"
                  label="Бюджет до"
                  error={errors.budget_kzt}
                  hint="За мероприятие, в тенге"
                >
                  <div className="input-unit">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      required
                      placeholder="Например, 500 000"
                      {...attrs('budget_kzt', true)}
                    />
                    <span aria-hidden="true">₸</span>
                  </div>
                </Field>
                <div className="optional-divider">
                  <span>Дополнительно · необязательно</span>
                </div>
                <div className="form-grid optional-grid">
                  <Field name="language" label="Язык" error={errors.language}>
                    {select('language', options?.languages ?? [], 'Неважно', true)}
                  </Field>
                  <Field
                    name="duration_hours"
                    label="Длительность, ч"
                    error={errors.duration_hours}
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Неважно"
                      {...attrs('duration_hours')}
                    />
                  </Field>
                </div>
                <Field
                  name="preferences"
                  label="Что ещё важно?"
                  optional
                  error={errors.preferences}
                >
                  <textarea
                    rows={3}
                    maxLength={500}
                    placeholder="Атмосфера, стиль, особые пожелания…"
                    {...attrs('preferences')}
                  />
                  <span className="character-count" aria-hidden="true">
                    {form.preferences.length}/500
                  </span>
                </Field>
                {notice && (
                  <p className="form-notice" role="status">
                    {notice}
                  </p>
                )}
                {Object.values(errors).some(Boolean) && (
                  <p className="validation-summary" role="alert">
                    Проверьте отмеченные поля.
                  </p>
                )}
                <button type="submit" className="primary-button" disabled={!options || loading}>
                  {loading ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
                  <span>{loading ? 'Подбираем…' : 'Подобрать подрядчиков'}</span>
                  {!loading && <ArrowRight size={18} />}
                </button>
                <p className="form-footnote">Учитываем дату, бюджет и ваши условия</p>
              </fieldset>
            </form>
          </aside>
          <Results
            result={result}
            loading={loading}
            error={requestError}
            dirty={dirty}
            onSuggestion={applySuggestion}
            onRetry={() => void submit()}
            headingRef={resultsHeading}
          />
        </div>
        <section className="how-strip" aria-label="Как устроен подбор">
          <div>
            <span>01</span>
            <p>
              <b>Ваши условия</b>Город, дата и бюджет
            </p>
          </div>
          <ArrowRight size={17} aria-hidden="true" />
          <div>
            <span>02</span>
            <p>
              <b>Точные совпадения</b>До трёх подходящих вариантов
            </p>
          </div>
          <ArrowRight size={17} aria-hidden="true" />
          <div>
            <span>03</span>
            <p>
              <b>Понятный выбор</b>Объяснение для каждого
            </p>
          </div>
        </section>
        <footer>
          <span className="footer-brand">
            сәт <span>Умный подбор подрядчиков</span>
          </span>
          <span>Хорошее событие начинается с людей.</span>
        </footer>
      </main>
      <dialog
        ref={dialog}
        className="how-dialog"
        aria-labelledby="how-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close()
        }}
      >
        <button
          className="dialog-close"
          aria-label="Закрыть"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
        <div className="state-icon">
          <Search />
        </div>
        <h2 id="how-title">От планов — к людям</h2>
        <ol>
          <li>
            <b>Расскажите о событии.</b> Укажите город, дату, категорию, тип мероприятия и бюджет.
            Язык, длительность и пожелания — по желанию.
          </li>
          <li>
            <b>Получите подходящие варианты.</b> Сервис проверит ограничения и покажет до трёх
            подрядчиков.
          </li>
          <li>
            <b>Узнайте, почему они подходят.</b> В каждой карточке есть объяснение на основе
            каталога. Если совпадений нет, можно изменить условия.
          </li>
        </ol>
        <p>
          Цены указаны «от» за мероприятие. Подбор не является бронированием. Вымышленные профили и
          дополненные данные отмечены отдельно.
        </p>
        <button
          className="primary-button"
          onClick={() => {
            dialog.current?.close()
            document.getElementById('city')?.focus()
          }}
        >
          Перейти к подбору
          <ArrowDown size={17} />
        </button>
      </dialog>
    </>
  )
}
