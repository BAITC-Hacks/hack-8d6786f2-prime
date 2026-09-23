import { Alternatives } from './Alternatives'
import {
  Asterisk,
  CalendarDays,
  Check,
  Info,
  MapPin,
  RotateCcw,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react'
import {
  capitalize,
  formatDate,
  formatMoney,
  type Recommendation,
  type Suggestion,
} from '../contracts'
import { ContractorCard } from './ContractorCard'
import { changesKey, showCondition } from './conditions'
import { SelectionDetails } from './SelectionDetails'
export function Results({
  result,
  previous,
  loading,
  error,
  dirty,
  onSuggestion,
  onRetry,
  headingRef,
}: {
  result: Recommendation | null
  previous: Recommendation | null
  loading: boolean
  error: string | null
  dirty: boolean
  onSuggestion: (s: Suggestion) => void
  onRetry: () => void
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  const cards = result?.cards ?? []
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
          <SelectionDetails result={result} previous={previous} />
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
            </div>
          )}
          <Alternatives
            alternatives={alternatives}
            suggestions={suggestions}
            query={result.query}
            onSuggestion={onSuggestion}
          />
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
