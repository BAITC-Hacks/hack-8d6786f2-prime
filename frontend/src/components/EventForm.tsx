import type { ReactNode } from 'react'
import { ArrowRight, ChevronDown, Info, LoaderCircle, Sparkles } from 'lucide-react'
import { capitalize, formatDate, type FieldName } from '../contracts'
import type { useRecommendation } from '../useRecommendation'
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
export function EventForm({ model }: { model: ReturnType<typeof useRecommendation> }) {
  const {
    options,
    optionsError,
    setOptionsAttempt,
    form,
    errors,
    loading,
    notice,
    formRef,
    update,
    submit,
  } = model
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
            <Field name="duration_hours" label="Длительность, ч" error={errors.duration_hours}>
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
  )
}
