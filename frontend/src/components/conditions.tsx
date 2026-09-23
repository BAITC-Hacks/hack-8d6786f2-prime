import {
  fieldLabels,
  formatDate,
  formatMoney,
  type FieldName,
  type Query,
  type Suggestion,
} from '../contracts'
export function showCondition(field: FieldName, value: Query[FieldName] | undefined) {
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
export function changesKey(changes: Suggestion['changes']) {
  return JSON.stringify(Object.entries(changes).sort(([a], [b]) => a.localeCompare(b)))
}
export function SuggestionChanges({
  changes,
  query,
}: {
  changes: Suggestion['changes']
  query: Query
}) {
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
