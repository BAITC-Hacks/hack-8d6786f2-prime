import { CalendarDays, ChevronDown, Clock3, Globe2, Info, Sparkles } from 'lucide-react'
import { capitalize, formatDate, formatMoney, type Contractor } from '../contracts'
export function ContractorCard({
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
