import { formatDate, type Recommendation } from '../contracts'

export function dateChanges(previous: Recommendation | null, current: Recommendation) {
  if (
    !previous ||
    previous.meta.dataset_version !== current.meta.dataset_version ||
    previous.query.date === current.query.date ||
    Object.entries(current.query).some(
      ([key, value]) =>
        key !== 'date' && value !== previous.query[key as keyof typeof current.query],
    )
  )
    return []
  const before = new Map(previous.assessments.map((row) => [row.id, row]))
  const after = new Map(current.assessments.map((row) => [row.id, row]))
  const changes: { id: string; name: string; reason: string }[] = []
  for (const card of previous.cards) {
    const next = after.get(card.id)
    if (next?.status === 'selected' || !next) continue
    changes.push({
      id: card.id,
      name: card.name,
      reason: next.reasons.includes('busy')
        ? 'Стал занят на новую дату по календарю каталога.'
        : next.status === 'not_selected'
          ? `По-прежнему свободен и подходит; теперь на ${next.rank}-м месте, за пределами первых трёх.`
          : 'Больше не проходит условия подбора.',
    })
  }
  for (const card of current.cards) {
    const old = before.get(card.id)
    if (!old || old.status === 'selected') continue
    changes.push({
      id: card.id,
      name: card.name,
      reason: old.reasons.includes('busy')
        ? 'На прежнюю дату был занят; на новую свободен и вошёл в первые три.'
        : 'Был свободен и раньше; после изменения доступности других кандидатов вошёл в первые три.',
    })
  }
  return changes
}

export function SelectionDetails({
  result,
  previous,
}: {
  result: Recommendation
  previous: Recommendation | null
}) {
  const changes = dateChanges(previous, result)
  return (
    <>
      {result.status !== 'no_category' && (
        <>
          <div className="rejections" aria-label="Причины исключения">
            <span>Заняты на дату: {result.rejections.busy}</span>
            {Object.entries(result.rejections)
              .filter(([key, count]) => key !== 'busy' && count > 0)
              .map(([key, count]) => (
                <span key={key}>
                  {
                    {
                      budget: 'Стартовая цена выше бюджета',
                      event_type: 'Не указан выбранный формат',
                      language: 'Не указан выбранный язык',
                      duration: 'Не подходит длительность',
                    }[key]
                  }
                  : {count}
                </span>
              ))}
          </div>
          <p className="selection-policy">
            Порядок: сначала меньшая стартовая цена, при равной цене — ID профиля. AI выбирает факты
            для объяснений после отбора.
          </p>
        </>
      )}
      {changes.length > 0 && (
        <section className="date-comparison" aria-labelledby="date-comparison-title">
          <h3 id="date-comparison-title">Что изменилось при смене даты</h3>
          <p>
            {formatDate(previous!.query.date)} → {formatDate(result.query.date)}. Остальные условия
            те же.
          </p>
          <ul>
            {changes.map((change) => (
              <li key={change.id}>
                <strong>{change.name}</strong> — {change.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
