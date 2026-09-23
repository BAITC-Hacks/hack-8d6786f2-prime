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
function ContractorCard({
  card,
  index,
  alternative = false,
}: {
  card: Contractor
  index: number
  alternative?: boolean
}) {
  const initials = card.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
  const excerpts = card.evidence.filter((item) => item.field === 'description')
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
      {(card.synthetic || card.price_imputed || card.city_imputed) && (
        <div className="data-badges" aria-label="Особенности данных">
          {card.synthetic && <span className="data-badge">Вымышленный профиль</span>}
          {card.price_imputed && <span className="data-badge">Цена подготовлена</span>}
          {card.city_imputed && <span className="data-badge">Город подготовлен</span>}
        </div>
      )}
      <div className="facts">
        <span className={alternative ? 'proposed-date' : 'available'}>
          <CalendarDays size={14} aria-hidden="true" />
          {alternative ? 'Предлагаемая дата: ' : 'Свободно по каталогу: '}
          {formatDate(card.available_on)}
        </span>
        {card.languages.length > 0 && (
          <span>
            <Globe2 size={14} aria-hidden="true" />
            {card.languages.map(capitalize).join(', ')}
          </span>
        )}
        {card.max_hours !== null ? (
          <span>
            <Clock3 size={14} aria-hidden="true" />
            До {card.max_hours} ч
          </span>
        ) : (
          <span>Длительность присутствия не применяется</span>
        )}
      </div>
      <div className="explanation">
        <h4>
          <Sparkles size={14} aria-hidden="true" />
          {alternative ? 'Почему подходит после изменений' : 'Почему подходит'}
        </h4>
        <p>{card.explanation || 'Объяснение не предоставлено.'}</p>
      </div>
      {excerpts.length > 0 && (
        <div className="source-facts">
          <h4>Цитата из описания в каталоге</h4>
          {excerpts.map((item, excerptIndex) => (
            <blockquote key={excerptIndex}>{item.value}</blockquote>
          ))}
        </div>
      )}
      {(card.price_imputed || card.city_imputed) && (
        <div className="data-notes">
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
      )}
      <div className="card-bottom">
        <details className="contractor-details">
          <summary>
            Полное описание из каталога <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="description">
            <p>{card.description || 'Дополнительное описание не указано.'}</p>
          </div>
        </details>
      </div>
    </article>
  )
}
function showCondition(field: FieldName, value: Query[FieldName] | undefined) {
  return value === null || value === '' || value === undefined
    ? 'без ограничений'
    : field === 'date'
      ? formatDate(String(value), true)
      : field === 'budget_kzt'
        ? formatMoney(Number(value))
        : field === 'duration_hours'
          ? value + ' ч'
          : String(value)
}
function changesKey(changes: Suggestion['changes']) {
  return JSON.stringify(Object.entries(changes).sort(([a], [b]) => a.localeCompare(b)))
}
function SuggestionChanges({ changes, query }: { changes: Suggestion['changes']; query: Query }) {
  return (
    <span className="suggestion-changes">
      {Object.entries(changes)
        .map(([key, value]) => {
          const field = key as FieldName
          return (
            fieldLabels[field] +
            ': ' +
            showCondition(field, query[field]) +
            ' → ' +
            showCondition(field, value)
          )
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
  const alternatives = result?.status === 'no_match' ? (result.alternatives ?? []) : []
  const seenChanges = new Set(alternatives.map((alternative) => changesKey(alternative.changes)))
  const suggestions = (result?.suggestions ?? []).filter((suggestion) => {
    const key = changesKey(suggestion.changes)
    if (!Object.keys(suggestion.changes).length || seenChanges.has(key)) return false
    seenChanges.add(key)
    return true
  })
  const outcomeTitles = {
    matched: 'Подобрали по вашим условиям',
    no_category: 'Такой категории в городе нет',
    no_match: 'Кандидаты есть, условия не совпали',
  }
  return (
    <section className="results" aria-labelledby="results-title" aria-busy={loading}>
      <div className="results-heading">
        <div>
          <p className="section-kicker">
            <span>02</span>Результат подбора
          </p>
          <h2 id="results-title" tabIndex={-1} ref={headingRef}>
            {loading
              ? 'Ищем совпадения'
              : error
                ? 'Подбор пока не завершён'
                : result
                  ? outcomeTitles[result.status]
                  : 'Варианты для вашего события'}
          </h2>
        </div>
        {result?.status === 'matched' && (
          <span className="count-pill">
            Показано {cards.length} из {result.eligible_count}
          </span>
        )}
      </div>
      <div
        className={'result-announcement' + (result ? ' outcome-' + result.status : '')}
        role="status"
        aria-live="polite"
      >
        {loading ? (
          <p>Проверяем условия и готовим объяснения…</p>
        ) : result ? (
          <>
            {result.status === 'matched' && result.eligible_count < 3 && (
              <strong>Почему меньше трёх</strong>
            )}
            <p>{result.summary}</p>
          </>
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
          <h3>Не удалось получить результат</h3>
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
            <span>{result.query.category}</span>
            <span>{capitalize(result.query.event_type)}</span>
            <span>Язык: {showCondition('language', result.query.language)}</span>
            <span>
              Длительность: {showCondition('duration_hours', result.query.duration_hours)}
            </span>
          </div>
          {result.status === 'matched' ? (
            <>
              {result.meta.explanation_mode === 'fallback' && (
                <p className="fallback-note">
                  <Info size={15} aria-hidden="true" />
                  Базовые объяснения по данным каталога (fallback).
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
            <div className={'state-panel empty-panel outcome-' + result.status}>
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
                  : 'Ни один профиль не прошёл все условия. Причины исключения показаны ниже; у одного профиля их может быть несколько.'}
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
                            budget: 'Стартовая цена выше бюджета',
                            event_type: 'Не указан выбранный формат',
                            language: 'Не указан выбранный язык',
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
          {(alternatives.length > 0 || suggestions.length > 0) && (
            <section className="alternatives" aria-labelledby="alternatives-title">
              <div className="alternatives-heading">
                <p className="eyebrow">ЕСЛИ МОЖНО ИЗМЕНИТЬ ПЛАНЫ</p>
                <h3 id="alternatives-title">Варианты с изменением условий</h3>
                <p>
                  Это не точные совпадения. Проверенные по каталогу предложения требуют изменений.
                  Кнопка только перенесёт указанные условия в форму. Затем отдельно нажмите
                  «Подобрать подрядчиков».
                </p>
              </div>
              {suggestions.length > 0 && (
                <div className="suggestions">
                  {suggestions.map((suggestion) => (
                    <button
                      key={changesKey(suggestion.changes)}
                      className="suggestion"
                      onClick={() => onSuggestion(suggestion)}
                    >
                      <span>
                        <b>{suggestion.label}</b>
                        <SuggestionChanges changes={suggestion.changes} query={result.query} />
                        <span className="suggestion-action">Применить условия</span>
                      </span>
                      <ArrowUpRight size={18} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
              {alternatives.map((alternative, index) => (
                <div className="alternative-option" key={alternative.card.id}>
                  <div className="alternative-differences">
                    <b>Альтернатива · потребуется изменить условия</b>
                    <ul>
                      {alternative.differences.map((difference) => (
                        <li key={difference.field}>
                          <strong>
                            {fieldLabels[difference.field]}: {difference.requested} →{' '}
                            {difference.proposed}
                          </strong>
                          <span>{difference.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {alternative.explanation_mode === 'fallback' && (
                    <p className="alternative-mode">
                      <Info size={14} aria-hidden="true" />
                      Базовое объяснение по данным каталога (fallback).
                    </p>
                  )}
                  <ContractorCard card={alternative.card} index={index + 10} alternative />
                  <button
                    className="secondary-button apply-alternative"
                    onClick={() =>
                      onSuggestion({
                        label: 'Условия для ' + alternative.card.name,
                        changes: alternative.changes,
                      })
                    }
                  >
                    Применить условия для {alternative.card.name}
                    <ArrowUpRight size={16} />
                  </button>
                </div>
              ))}
              <p className="results-footnote">
                Цены указаны «от». Альтернатива не является бронированием.
              </p>
            </section>
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
          <div className="eyebrow">ПОДРЯДЧИКИ, ПЛОЩАДКИ И УСЛУГИ</div>
          <h3>{dirty ? 'Обновим подбор под ваши планы' : 'Что подойдёт вашему событию'}</h3>
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
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#/" aria-label="сәт — главная">
            <span>
              <Asterisk size={27} strokeWidth={2} />
            </span>
            сәт<span className="brand-dot">.</span>
          </a>
          <nav aria-label="Основная навигация">
            <a href="#event-form">Подбор</a>
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
              ПОДРЯДЧИКИ, ПЛОЩАДКИ И УСЛУГИ
            </p>
            <h1 id="hero-title">
              Ваше событие.
              <br />
              <em>Подходящие решения.</em>
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
                    Календарь каталога: {formatDate(options.calendar.min)} —{' '}
                    {formatDate(options.calendar.max, true)}
                  </p>
                )}
                <Field name="event_type" label="Тип мероприятия" error={errors.event_type}>
                  {select('event_type', options?.event_types ?? [], 'Какое событие планируете?')}
                </Field>
                <Field name="category" label="Категория" error={errors.category}>
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
          <span>Хорошее событие начинается с выбора.</span>
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
        <h2 id="how-title">От планов — к подходящим решениям</h2>
        <ol>
          <li>
            <b>Расскажите о событии.</b> Укажите город, дату, категорию, тип мероприятия и бюджет.
            Язык и длительность — по желанию.
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
