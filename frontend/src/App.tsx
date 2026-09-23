import { useRef } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Asterisk, Search, X } from 'lucide-react'
import { api, type Api } from './api'
import { useRecommendation } from './useRecommendation'
import { EventForm } from './components/EventForm'
import { Results } from './components/RecommendationResults'
export default function App({ client = api }: { client?: Api }) {
  const model = useRecommendation(client)
  const {
    result,
    previous,
    loading,
    requestError,
    dirty,
    applySuggestion,
    submit,
    resultsHeading,
  } = model
  const dialog = useRef<HTMLDialogElement>(null)

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
          <EventForm model={model} />
          <Results
            result={result}
            previous={previous}
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
