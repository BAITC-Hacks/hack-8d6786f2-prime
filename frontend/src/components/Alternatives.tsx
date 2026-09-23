import { ArrowUpRight, Info } from 'lucide-react'
import { fieldLabels, type Recommendation, type Query, type Suggestion } from '../contracts'
import { ContractorCard } from './ContractorCard'
import { changesKey, SuggestionChanges } from './conditions'

export function Alternatives({
  alternatives,
  suggestions,
  query,
  onSuggestion,
}: {
  alternatives: NonNullable<Recommendation['alternatives']>
  suggestions: Suggestion[]
  query: Query
  onSuggestion: (suggestion: Suggestion) => void
}) {
  if (!alternatives.length && !suggestions.length) return null
  return (
    <section className="alternatives" aria-labelledby="alternatives-title">
      <div className="alternatives-heading">
        <p className="eyebrow">ЕСЛИ МОЖНО ИЗМЕНИТЬ ПЛАНЫ</p>
        <h3 id="alternatives-title">Варианты с изменением условий</h3>
        <p>
          Это не точные совпадения. Проверенные по каталогу предложения требуют изменений. Кнопка
          только перенесёт указанные условия в форму. Затем отдельно нажмите «Подобрать
          подрядчиков».
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
                <SuggestionChanges changes={suggestion.changes} query={query} />
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
                    {fieldLabels[difference.field]}: {difference.requested} → {difference.proposed}
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
      <p className="results-footnote">Цены указаны «от». Альтернатива не является бронированием.</p>
    </section>
  )
}
