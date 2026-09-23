# Матрица требований

Источник — кейс HackAlem AI #79-lite. Объём этой версии: параметры заказа, до трёх рекомендаций, объяснения и понятные пустые результаты. Альтернативы при изменении условий сохранены по решению капитана.

| Требование | Проверка |
| --- | --- |
| Пять обязательных параметров, язык и длительность опциональны | backend/tests/test_api.py, frontend/src/contracts.test.ts |
| Не более трёх точных совпадений, занятые исключены | backend/tests/test_api.py, qa/test_recommendation_http.py |
| Три различимых исхода, объяснённая неполная выдача | backend/tests/test_api.py, frontend/tests/backend.spec.ts |
| Повторяемый порядок и смена даты | backend/tests/test_api.py, qa/test_recommendation_http.py |
| Сохранность всех 66 записей и флагов | backend/tests/test_catalog.py, test_seed_lifecycle.py |
| Сбой AI сохраняет корректные карточки | backend/tests/test_explainer.py |
| Проверенные отдельные альтернативы | qa/test_recommendation_http.py, frontend/tests/alternatives.spec.ts |
| Полезность и невзаимозаменяемость объяснений | Требует ручной приёмки; открытые случаи в known-issues.md |
| Разумная задержка | Измерять fallback, новый LLM-запрос и кеш отдельно |
| Воспроизводимый запуск | README, docs/demo.md, scripts/verify_windows.py |

Оценка: соответствие и работа — 25, техника — 25, README и воспроизводимость — 25, ценность — 15, развитие — 10. Главный приоритет кейса — объяснения. Число автоматических тестов не является оценкой жюри.

[Сценарий защиты](demo.md) · [Открытые проблемы](known-issues.md) · [Порядок приёмки](../qa/README.md).
