import urllib.request, json, websocket, time, subprocess

CHROME_PATH = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9355
proc = subprocess.Popen([CHROME_PATH, '--headless=new', f'--remote-debugging-port={PORT}', '--remote-allow-origins=*', '--no-sandbox', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

try:
    req = urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json')
    tabs = json.loads(req.read().decode())
    page_tab = next((t for t in tabs if t.get('type') == 'page' and not t.get('url', '').startswith('chrome-extension://')), None)
    if not page_tab:
        page_tab = tabs[0]
    ws = websocket.create_connection(page_tab['webSocketDebuggerUrl'])

    def send(m, p=None):
        ws.send(json.dumps({'id': 1, 'method': m, 'params': p or {}}))
        return json.loads(ws.recv())

    send('Page.enable')
    send('Runtime.enable')
    send('Page.navigate', {'url': 'http://127.0.0.1:8000/#/login'})
    time.sleep(2.0)

    code = '''
    (() => {
        const ids = Array.from(document.querySelectorAll('*[id]')).map(e => e.id);
        const inputs = Array.from(document.querySelectorAll('input')).map(i => ({ id: i.id, name: i.name, type: i.type, placeholder: i.placeholder }));
        return {
            href: window.location.href,
            inputs: inputs,
            hasLoginForm: !!document.getElementById('login-form'),
            hasUsername: !!document.getElementById('login-username')
        };
    })()
    '''
    ws.send(json.dumps({'id': 2, 'method': 'Runtime.evaluate', 'params': {'expression': code, 'returnByValue': True}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == 2:
            print('DOM INSPECTION:', json.dumps(msg.get('result', {}).get('result', {}).get('value'), indent=2))
            break
finally:
    proc.terminate()
