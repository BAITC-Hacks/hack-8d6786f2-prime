import type { Options, Query, Recommendation, Contractor } from '../contracts'
import { recommendationSchema } from '../contracts'

export const mockOptions: Options = {
  cities: ['Алматы', 'Астана', 'Зарубежье'],
  categories: ['Ведущий', 'Флорист', 'Декоратор'],
  event_types: ['свадьба', 'той', 'корпоратив', 'конференция', 'юбилей', 'день рождения'],
  languages: ['русский', 'казахский', 'английский'],
  calendar: { min: '2026-09-23', max: '2026-12-31' },
  dataset: { version: 'DEMO-ONLY', profiles_count: 3 },
}
export const mockQuery: Query = {
  city: 'Алматы',
  date: '2026-11-14',
  event_type: 'корпоратив',
  category: 'Ведущий',
  budget_kzt: 1500000,
  duration_hours: 6,
  language: 'русский',
}
const demoCard: Contractor = {
  id: 'demo-1',
  name: 'Алексей С.',
  categories: ['Ведущий'],
  city: 'Алматы',
  price_from_kzt: 650000,
  languages: ['русский'],
  max_hours: 8,
  available_on: '2026-11-14',
  description:
    'Вымышленный профиль для проверки интерфейса. Ведёт корпоративные события, помогает с программой и вовлекает гостей в общение.',
  explanation:
    'Ведёт корпоративы на русском языке и свободен в выбранную дату. Стоимость укладывается в бюджет, а допустимая длительность покрывает ваши 6 часов.',
  evidence: [{ field: 'price_from_kzt', value: '650000' }],
  synthetic: true,
  price_imputed: false,
  city_imputed: false,
}
export const mockCards: Contractor[] = [
  demoCard,
  {
    ...demoCard,
    id: 'demo-2',
    name: 'Марат К.',
    price_from_kzt: 800000,
    languages: ['казахский', 'русский'],
    max_hours: 6,
    explanation:
      'Работает с корпоративными мероприятиями и ведёт на двух языках. Доступен на вашу дату и может присутствовать все 6 часов.',
  },
  {
    ...demoCard,
    id: 'demo-3',
    name: 'Дана А.',
    price_from_kzt: 950000,
    languages: ['русский', 'английский'],
    max_hours: 7,
    price_imputed: true,
    city_imputed: true,
    explanation:
      'Опыт корпоративных событий и русский язык соответствуют запросу. Свободна 14 ноября, стоимость — в пределах указанного бюджета.',
  },
]
export type Scenario =
  'matched' | 'one' | 'two' | 'no_category' | 'no_match' | 'fallback' | 'error' | 'validation'
export function makeMockResponse(
  query: Query = mockQuery,
  scenario: Scenario = 'matched',
): Recommendation {
  const empty = scenario === 'no_category' || scenario === 'no_match'
  const cards = empty ? [] : mockCards.slice(0, scenario === 'one' ? 1 : scenario === 'two' ? 2 : 3)
  const total = scenario === 'no_category' ? 0 : 10
  const eligible = empty ? 0 : cards.length === 3 ? 4 : cards.length
  const assessments: Recommendation['assessments'] = Array.from({ length: total }, (_, index) => ({
    id: mockCards[index]?.id ?? `demo-${index + 1}`,
    name: mockCards[index]?.name ?? `Профиль ${index + 1}`,
    rank: index < eligible ? index + 1 : null,
    status:
      index < Math.min(3, eligible) ? 'selected' : index < eligible ? 'not_selected' : 'excluded',
    reasons: index < eligible ? [] : scenario === 'no_match' && index < 2 ? ['busy'] : ['budget'],
  }))
  return recommendationSchema.parse({
    status: empty ? scenario : 'matched',
    query,
    total_in_category: total,
    eligible_count: eligible,
    assessments,
    cards: cards.map((card) => ({ ...card, available_on: query.date })),
    summary:
      scenario === 'no_category'
        ? 'В выбранном городе нет подрядчиков этой категории.'
        : scenario === 'no_match'
          ? 'Подрядчики в этой категории есть, но никто не соответствует всем условиям.'
          : cards.length === 3
            ? 'Найдено 4 подходящих подрядчика. Показываем 3.'
            : 'Подходящих подрядчиков: ' + cards.length + '. Показываем всех.',
    rejections: {
      busy: scenario === 'no_match' ? 2 : 0,
      budget: total - eligible - (scenario === 'no_match' ? 2 : 0),
      event_type: 0,
      language: 0,
      duration: 0,
    },
    suggestions:
      scenario === 'no_match'
        ? [{ label: 'Проверить другую дату', changes: { date: '2026-11-15' } }]
        : [],
    meta: {
      dataset_version: 'DEMO-ONLY',
      explanation_mode: scenario === 'fallback' ? 'fallback' : 'llm',
      latency_ms: 680,
    },
  })
}
