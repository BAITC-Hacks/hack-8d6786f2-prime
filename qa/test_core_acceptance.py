"""Focused requirements regression; known quality defects deliberately fail.

No application imports, edits, keys, or external AI calls. The existing project's
HTTP process helper supplies a temporary database. QA_SOURCE_ROOT can point to an
unchanged source snapshot. Every request uses the running API, without cached
responses, so this suite can verify application fixes.
"""
from contextlib import ExitStack
import csv
from datetime import date
import json
import os
from pathlib import Path
import sys
import time

import pytest

ROOT = Path(os.getenv('QA_SOURCE_ROOT', str(Path(__file__).resolve().parents[1]))).resolve()
COMMIT = 'b68da2d8d8e96c7d39a3ce97c7cd6c6a669a1c9c'
BASE = dict(city='Алматы', date='2026-11-14', event_type='корпоратив', category='Ведущий',
            budget_kzt=1500000, duration_hours=6, language='русский')


@pytest.fixture(scope='module')
def source_rows():
    with (ROOT/'data/contractors.csv').open(encoding='utf-8-sig', newline='') as source:
        return {row['id']: row for row in csv.DictReader(source)}


@pytest.fixture(scope='module')
def request_case(tmp_path_factory):
    assert (ROOT/'qa/test_recommendation_http.py').is_file(), 'Set QA_SOURCE_ROOT to the project root'
    sys.path.insert(0, str(ROOT/'qa'))
    from test_recommendation_http import isolated_server
    recordings=[]
    with ExitStack() as stack:
        client=None

        def send(query):
            nonlocal client
            if client is None:
                directory=tmp_path_factory.mktemp('core-acceptance-sql')
                client=stack.enter_context(isolated_server(directory/'catalog.sqlite3'))
                assert client.get('/api/health').json()['ai_available'] is False
            start=time.perf_counter()
            response=client.post('/api/recommend',json=query)
            data=response.json()
            recordings.append(dict(request=query,http=response.status_code,actual=data,
                                   elapsed_ms=round((time.perf_counter()-start)*1000,3),source='new-real-HTTP'))
            assert response.status_code==200, response.text
            assert data['meta']['explanation_mode']=='fallback'
            return data

        yield send
    if os.getenv('QA_RESULTS_PATH'):
        output=Path(os.environ['QA_RESULTS_PATH'])
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps(dict(baseline_commit=COMMIT,
            reviewed_commit=os.getenv('QA_REVIEWED_COMMIT'),
            requests=recordings),ensure_ascii=False,indent=2)+'\n')


CALENDAR_PAIRS = [
    ('person-december-start', 'HK-88430', dict(budget_kzt=500000), '2026-12-07', '2026-12-08'),
    ('person-december-end', 'HK-88430', dict(budget_kzt=500000), '2026-12-30', '2026-12-29'),
    ('venue-banquet-year-end', 'HK-90012', dict(city='Астана',category='Банкетный зал',event_type='конференция',budget_kzt=2800000,language='английский',duration_hours=10), '2026-12-30', '2026-12-31'),
    ('venue-hotel-year-end', 'HK-90012', dict(city='Астана',category='Отель',event_type='конференция',budget_kzt=2800000,language='английский',duration_hours=10), '2026-12-30', '2026-12-31'),
    ('florist-null-hours', 'HK-90002', dict(city='Астана',category='Флорист',event_type='свадьба',budget_kzt=300000,language=None,duration_hours=100), '2026-12-30', '2026-12-29'),
]


@pytest.mark.parametrize('name,target,changes,busy,free',CALENDAR_PAIRS,ids=[case[0] for case in CALENDAR_PAIRS])
def test_december_calendar_date_only_changes_availability(request_case,source_rows,name,target,changes,busy,free):
    row=source_rows[target]
    assert busy in row['busy_dates'].split('|') and free not in row['busy_dates'].split('|')
    busy_query={**BASE,**changes,'date':busy}
    free_query={**busy_query,'date':free}
    blocked=request_case(busy_query)
    allowed=request_case(free_query)
    assert blocked['status']=='no_match' and blocked['cards']==[]
    assert blocked['eligible_count']==0 and blocked['rejections']['busy']>0
    assert 'заняты' in blocked['summary']
    assert allowed['status']=='matched' and allowed['eligible_count']==1
    assert [card['id'] for card in allowed['cards']]==[target]
    card=allowed['cards'][0]
    assert card['available_on']==free and date.fromisoformat(free).strftime('%d.%m.%Y') in card['explanation']
    assert 'свободен' in card['explanation']
    if name=='florist-null-hours':
        assert row['max_hours']=='' and card['max_hours'] is None


def test_last_calendar_day_never_suggests_unknown_january(request_case,source_rows):
    query={**BASE,'date':'2026-12-31','budget_kzt':500000}
    data=request_case(query)
    assert data['status']=='no_match' and not data['cards']
    assert data['suggestions']==[], 'No forward dates exist within the source calendar'
    assert data['alternatives'], 'The current contract supports separately labelled changes'
    for alternative in data['alternatives']:
        changes=alternative['changes']
        assert set(changes)<={'date','budget_kzt','language','duration_hours'}
        proposed={**query,**changes}
        card=alternative['card']; row=source_rows[card['id']]
        assert '2026-09-23'<=proposed['date']<='2026-12-31'
        assert proposed['date'] not in row['busy_dates'].split('|')
        assert proposed['event_type'] in row['event_formats'].split('|')
        assert card['city']==proposed['city'] and proposed['category'] in card['categories']
        assert int(row['price_from_kzt'])<=proposed['budget_kzt']
        assert proposed['language'] is None or proposed['language'] in row['languages'].split('|')
        assert proposed['duration_hours'] is None or not row['max_hours'] or proposed['duration_hours']<=float(row['max_hours'])
        replay=request_case(proposed)
        assert replay['status']=='matched' and card['id'] in [c['id'] for c in replay['cards']]


@pytest.mark.parametrize('day',['2026-09-23','2026-12-25'])
def test_explanations_remain_distinguishable_after_names_are_removed(request_case,day):
    query={**BASE,'date':day,'event_type':'свадьба','category':'Лайв-бэнд',
           'budget_kzt':10000000,'language':None,'duration_hours':None}
    data=request_case(query)
    pair={c['id']:c for c in data['cards'] if c['id'] in {'HK-23752','HK-83709'}}
    assert len(pair)==2, 'Counterexample precondition: both profiles must be shown'
    anonymized=[]
    for card in pair.values():
        explanation=card['explanation']
        for name in (card['name'],'Thunder Breath Band','Eva Sound'):
            explanation=explanation.replace(name,'[ИМЯ]')
        anonymized.append(explanation)
    assert anonymized[0]!=anonymized[1], 'OPEN QA-Q01: explanations become identical after names are removed'


def test_quote_does_not_stop_in_the_middle_of_the_source_clause(request_case,source_rows):
    query={**BASE,'date':'2026-09-23','event_type':'свадьба','budget_kzt':10000000,
           'language':'казахский','duration_hours':10}
    data=request_case(query)
    card=next(c for c in data['cards'] if c['id']=='HK-42352')
    quote=next(item['value'] for item in card['evidence'] if item['field']=='description')
    description=source_rows['HK-42352']['description']
    assert quote and quote in description, 'Grounding is necessary but not sufficient for readable text'
    remainder=description[description.index(quote)+len(quote):].lstrip()
    # Targeted regression for the manually reviewed paragraph, not a universal NLP validator.
    assert not remainder or quote.rstrip()[-1] in '.!?;:' or remainder[0] in '.!?;:', \
        'OPEN QA-Q02: selected text stops before the clause ends: '+quote[-50:]
