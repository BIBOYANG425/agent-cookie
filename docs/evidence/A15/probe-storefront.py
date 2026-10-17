import datetime,json,pathlib,re,httpx
root=pathlib.Path('/private/tmp/agent-cookie-a15-f4_1ai5k')
wire=json.loads((root/'tier0-wire.jsonl').read_text().splitlines()[0])
with httpx.Client(base_url='http://127.0.0.1:8000',trust_env=False,follow_redirects=False,timeout=60) as http:
    health=http.get('/api/health'); health.raise_for_status()
    catalog=http.get('/api/products',params={'limit':100}); catalog.raise_for_status()
    products=catalog.json()['products']
    opened=http.post('/api/session',json={'user_id':wire['request']['body']['session_id']}); opened.raise_for_status()
    session=opened.json()
    token=session['session_id']
    assert session['user_id']==wire['request']['body']['session_id']
    body={'message':wire['request']['body']['message'],'page':{'page_type':'home'}}
    response=http.post('/api/chat',headers={'X-Session-Id':token,'Accept':'text/event-stream'},json=body)
    events=[]
    for frame in response.text.replace('\r\n','\n').split('\n\n'):
        etype='message';data=[]
        for line in frame.splitlines():
            if line.startswith('event:'):etype=line.split(':',1)[1].strip()
            if line.startswith('data:'):data.append(line.split(':',1)[1].lstrip())
        if data:events.append({'event':etype,'data':json.loads('\n'.join(data))})
    reply=''.join(e['data'].get('text','') for e in events if e['event']=='text_delta')
    record={'observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'scope':'Separate diagnostic using the correct original session/header/SSE protocol; NOT the workspace Tier 0 path and NOT A15 success.',
      'health':{'status':health.status_code,'body':health.json()},
      'catalog':{'status':catalog.status_code,'productCount':len(products),'footwearTitleMatches':sum(bool(re.search(r'\b(shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals)\b',p.get('title',''),re.I)) for p in products)},
      'session':{'status':opened.status_code,'subjectMatchesWorkspacePairwiseId':True,'tokenRecorded':False},
      'chat':{'method':'POST','path':'/api/chat','hasXSessionIdHeader':True,'body':body,'status':response.status_code,'contentType':response.headers.get('content-type'),'events':events,'firstAssistantReply':reply or None,'firstAssistantReplyContains42':bool(reply and '42' in reply),'hasTurnComplete':any(e['event']=='turn_complete' for e in events)}}
    serialized=json.dumps(record,ensure_ascii=False,indent=2)+'\n'
    assert token not in serialized
    (root/'correct-protocol-probe.json').write_text(serialized)
    print(json.dumps({'healthStatus':health.status_code,'products':len(products),'sessionStatus':opened.status_code,'chatStatus':response.status_code,'eventTypes':[e['event'] for e in events],'assistantReplyPresent':bool(reply),'tokenRecorded':False}))
