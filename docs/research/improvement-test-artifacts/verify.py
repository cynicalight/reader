"""Offline checks only. Never starts Reader or calls a model."""
import json
from pathlib import Path
from collections import defaultdict
source = Path(__file__).resolve().parents[1] / '2026-10-07-reader-improvement.jsonl'
rows = [json.loads(line) for line in source.read_text().splitlines()]
assert len(rows) == 36, len(rows)
groups = defaultdict(list)
for r in rows:
    groups[(r['block'], r['condition'])].append(r)
assert set(groups) == {(b,c) for b in (1,2) for c in ('baseline','dedup','session')}
all_totals = dict(inputTokens=0,outputTokens=0,totalTokens=0,cachedInputTokens=0)
for (block, condition), records in sorted(groups.items()):
    assert [r['round'] for r in records] == list(range(1,7))
    sums = {k:0 for k in all_totals}
    per_thread = defaultdict(lambda:{k:0 for k in all_totals})
    for i,r in enumerate(records):
        assert r['httpStatus']==200 and 'event: done' in r['sse']
        assert 'event: error' not in r['sse'] and 'event: fallback' not in r['sse']
        assert r['semanticOK'] and r['previousBuiltAnswerPresent']
        assert all(s in r['answer'] for s in r['expectedFragments'])
        assert len(r['messages']) == 2*(i+1) and len(r['usage']['calls']) == i+1
        assert r['messages'][-1]['role']=='assistant' and r['messages'][-1]['content']==r['answer']
        assert r['messages'][-2]['content']==r['question'] and r['messages'][-2].get('context','')==r['context']
        assert r['question'] in r['builtPrompt'] and r['question'] in r['sentPrompt']
        call = r['usage']['calls'][-1]
        assert call['status']=='complete' and call['provider']=='codex'
        assert len(call['models'])==1 and call['models'][0]['model']=='gpt-6.1-sol'
        t=call['models'][0]['tokens']
        assert t['inputTokens']+t['outputTokens']==t['totalTokens'] and 0<=t['cachedInputTokens']<=t['inputTokens']
        for k in sums:sums[k]+=t[k]
        if condition!='baseline':
            assert '\ufffd' not in r['builtPrompt']
            if r['context']:assert r['builtPrompt'].count(r['context'])==1
        if condition=='session':
            raw=r['providerUsage']['tokenUsage']
            for k in sums:
                assert raw['last'][k]==t[k], (block,i,k)
                per_thread[r['threadId']][k]+=t[k]
                assert per_thread[r['threadId']][k]==raw['total'][k]
            if i>0 and not r['explicitRestart']:
                # A factual answer can also occur in the newly supplied source; that is valid.
                assert '<conversation>' not in r['sentPrompt']
    for k in sums:
        assert records[-1]['usage']['total'][k]==sums[k]
        all_totals[k]+=sums[k]
    if condition=='session':
        assert len({r['threadId'] for r in records}) == (1 if block==1 else 2)
        if block==2:
            assert records[-1]['explicitRestart'] and records[-1]['processStarts']==2
            assert records[-1]['threadId']!=records[-2]['threadId']
            assert '730' in records[-1]['sentPrompt'] and '910' in records[-1]['sentPrompt']
    else:assert len({r['threadId'] for r in records})==6
    print(block,condition,sums,'cacheRatio=',round(100*sums['cachedInputTokens']/sums['inputTokens'],2))
print('TOTAL',all_totals)
print('PASS: all 36 Reader calls; persisted replies, source checks, thread reuse/rebuild and per-turn usage verified')
