import json, os, urllib.request, time
KEY = os.environ['DEEPSEEK_API_KEY']
def chat(system, user, model='deepseek-v4-pro', retries=5, effort='low'):
    body = {'model': model, 'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
            'temperature': 0, 'response_format': {'type': 'json_object'}, 'stream': True,
            'stream_options': {'include_usage': True}}
    if effort: body['reasoning_effort'] = effort
    err = None
    for i in range(retries):
        try:
            req = urllib.request.Request('https://api.deepseek.com/chat/completions', data=json.dumps(body).encode(),
                headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
            content = []; usage = None
            with urllib.request.urlopen(req, timeout=900) as r:
                for raw in r:
                    line = raw.decode().strip()
                    if not line.startswith('data:'): continue
                    data = line[5:].strip()
                    if data == '[DONE]': break
                    chunk = json.loads(data)
                    if chunk.get('usage'): usage = chunk['usage']
                    for ch in chunk.get('choices', []):
                        c = ch.get('delta', {}).get('content')
                        if c: content.append(c)
            return json.loads(''.join(content)), usage
        except Exception as e:
            err = e; time.sleep(3 * (i + 1))
    raise err
