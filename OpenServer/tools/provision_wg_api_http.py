import os
import sys
import textwrap
import secrets

HOST = os.environ.get("WG_HOST", "45.151.183.153")
USER = os.environ.get("WG_USER", "root")
PASSWORD = os.environ.get("WG_PASS", "760RBeSbt57T")
API_HOST = os.environ.get("WG_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("WG_API_PORT", "8789"))
PUB_ENDPOINT_VALUE = os.environ.get("PUB_ENDPOINT")

SCRIPT = textwrap.dedent(
    r"""
#!/usr/bin/env python3
import os, json, secrets, argparse, subprocess, time, socket, ipaddress
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

TOKEN_FILE = '/etc/wireguard/api_token'
CTRL_SCRIPT = '/usr/local/bin/tcpdump_ctrl.sh'
WG_API = '/usr/local/bin/wg-api.sh'
PROXY_SERVICE = os.environ.get('PROXY_SERVICE', '3proxy')
PROXY_USERS = os.environ.get('PROXY_USERS', '/etc/3proxy/conf/users.lst')
PROXY_SOCKS_PORT = int(os.environ.get('PROXY_SOCKS_PORT', '1080'))
PROXY_HTTP_PORT = int(os.environ.get('PROXY_HTTP_PORT', '8080'))
SERVER_LOG = '/var/log/vpn_connection_server_log'
DEBUG_STATE_FILE = '/var/run/vpn_debug_logging.json'
DEVICE_STORE = '/etc/wireguard/device_profiles'
WG_INTERFACE = os.environ.get('WG_INTERFACE', 'wg0')
WG_CONFIG_PATH = os.environ.get('WG_CONFIG_PATH', f'/etc/wireguard/{WG_INTERFACE}.conf')
PUB_ENDPOINT = os.environ.get('PUB_ENDPOINT')
PROBE_PORTS_FILE = os.environ.get('PROBE_PORTS_FILE', '/etc/wireguard/probe_ports.txt')
DEFAULT_PROBE_PORTS = [443]

class ClientRequestError(Exception):
    pass

def write_server_log(message):
    try:
        timestamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        with open(SERVER_LOG, 'a') as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass

def iso_timestamp():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

def sanitize_device_id(raw):
    if raw is None:
        return None
    cleaned = []
    for ch in str(raw).strip():
        if ch.isalnum():
            cleaned.append(ch.lower())
        elif ch in ('-', '_'):
            cleaned.append(ch)
        else:
            cleaned.append('-')
    result = ''.join(cleaned).strip('-_')
    if not result:
        return None
    return result[:80]

def sanitize_peer_name(raw, fallback):
    base = (raw or '').strip()
    if not base:
        base = fallback
    cleaned = []
    for ch in base:
        if ch.isalnum():
            cleaned.append(ch)
        elif ch in ('-', '_'):
            cleaned.append(ch)
        else:
            cleaned.append('-')
    name = ''.join(cleaned).strip('-_')
    return name or fallback

def ensure_device_store():
    os.makedirs(DEVICE_STORE, exist_ok=True)
    os.chmod(DEVICE_STORE, 0o700)

def device_profile_path(device_id):
    ensure_device_store()
    return os.path.join(DEVICE_STORE, f"{device_id}.json")

def read_device_profile(device_id):
    path = device_profile_path(device_id)
    if not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        try:
            return json.load(f)
        except Exception:
            return None

def write_device_profile(profile):
    path = device_profile_path(profile['device_id'])
    tmp_path = f"{path}.tmp"
    with open(tmp_path, 'w') as f:
        json.dump(profile, f, indent=2)
    os.chmod(tmp_path, 0o600)
    os.replace(tmp_path, path)

def mask_private_key(config_text):
    redacted = []
    for line in (config_text or '').splitlines():
        if line.lower().startswith('privatekey'):
            redacted.append('PrivateKey = ***')
        else:
            redacted.append(line)
    return '\n'.join(redacted)

def parse_config_metadata(config_text):
    info = {'address': None, 'private_key': None}
    for line in (config_text or '').splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        lower = stripped.lower()
        if lower.startswith('privatekey'):
            info['private_key'] = stripped.split('=', 1)[1].strip()
        elif lower.startswith('address'):
            address_field = stripped.split('=', 1)[1].strip()
            address_part = address_field.split(',')[0].strip()
            info['address'] = address_part.split('/')[0].strip()
    return info

def _split_allowed_values(raw):
    parts = []
    for chunk in raw.replace(',', ' ').split():
        cleaned = chunk.strip()
        if cleaned:
            parts.append(cleaned)
    return parts

def find_public_key_by_ip(ip):
    target = f"{ip}/32"
    try:
        allowed = run_cmd(['wg', 'show', WG_INTERFACE, 'allowed-ips'])
        for line in allowed.splitlines():
            parts = line.split()
            if len(parts) >= 2:
                peer = parts[0].strip()
                allowed_values = _split_allowed_values(' '.join(parts[1:]))
                if target in allowed_values:
                    return peer
    except Exception:
        pass
    if os.path.exists(WG_CONFIG_PATH):
        current_pub = None
        with open(WG_CONFIG_PATH, 'r') as f:
            for raw_line in f:
                line = raw_line.strip()
                lower = line.lower()
                if lower.startswith('[peer]'):
                    current_pub = None
                    continue
                if lower.startswith('publickey'):
                    current_pub = line.split('=', 1)[1].strip()
                    continue
                if lower.startswith('allowedips') and current_pub:
                    allowed_values = [item.strip() for item in line.split('=', 1)[1].split(',')]
                    if target in allowed_values:
                        return current_pub
    return None

def peer_has_allowed_ip(pubkey, ip):
    if not pubkey or not ip:
        return False
    target = f"{ip}/32"
    try:
        allowed = run_cmd(['wg', 'show', WG_INTERFACE, 'allowed-ips'])
    except Exception:
        return False
    for line in allowed.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].strip() == pubkey:
            allowed_values = _split_allowed_values(' '.join(parts[1:]))
            if target in allowed_values:
                return True
    return False

def get_server_network():
    try:
        with open(WG_CONFIG_PATH, 'r') as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line.lower().startswith('address'):
                    continue
                addr_field = line.split('=', 1)[1].strip().split(',')[0].strip()
                return ipaddress.ip_interface(addr_field).network
    except Exception:
        return None

def get_listen_port():
    try:
        with open(WG_CONFIG_PATH, 'r') as f:
            for raw_line in f:
                line = raw_line.strip()
                if line.lower().startswith('listenport'):
                    value = line.split('=', 1)[1].strip()
                    return int(value)
    except Exception:
        pass
    try:
        output = subprocess.check_output(['wg', 'show', WG_INTERFACE, 'listen-port'], text=True).strip()
        if output:
            return int(output)
    except Exception:
        pass
    return 443

def extract_endpoint_port(config_text):
    if not config_text:
        return None
    for line in config_text.splitlines():
        stripped = line.strip()
        if not stripped.lower().startswith('endpoint'):
            continue
        value = stripped.split('=', 1)[1].strip()
        if ':' not in value:
            continue
        port_part = value.rsplit(':', 1)[-1]
        try:
            return int(port_part)
        except ValueError:
            return None
    return None

VPN_NETWORK = get_server_network()
LISTEN_PORT = get_listen_port()

def needs_profile_refresh(profile):
    if not profile:
        return False
    ip_value = profile.get('ip')
    if not ip_value:
        return True
    try:
        ip_obj = ipaddress.ip_address(ip_value)
    except ValueError:
        return True
    if VPN_NETWORK and ip_obj not in VPN_NETWORK:
        return True
    config_text = profile.get('config') or ''
    if PUB_ENDPOINT and PUB_ENDPOINT not in config_text:
        return True
    profile_port = extract_endpoint_port(config_text)
    if profile_port and LISTEN_PORT and profile_port != LISTEN_PORT:
        return True
    return False

def retire_device_peer(profile):
    pub = (profile or {}).get('public_key')
    if not pub:
        return
    try:
        run_cmd([WG_API, 'remove-peer', pub])
        write_server_log(f"device_profile_retired pubkey={pub[:10]}")
    except Exception as exc:
        write_server_log(f"device_profile_retire_failed pubkey={pub[:10]} error={exc}")

def peer_block_exists(pubkey, ip):
    if not pubkey or not ip or not os.path.exists(WG_CONFIG_PATH):
        return False
    target = f"{ip}/32"
    current_pub = None
    with open(WG_CONFIG_PATH, 'r') as f:
        for raw_line in f:
            line = raw_line.strip()
            lower = line.lower()
            if lower.startswith('[peer]'):
                current_pub = None
                continue
            if lower.startswith('publickey'):
                current_pub = line.split('=', 1)[1].strip()
                continue
            if lower.startswith('allowedips') and current_pub == pubkey:
                allowed_values = [item.strip() for item in line.split('=', 1)[1].split(',')]
                if target in allowed_values:
                    return True
    return False

def append_peer_block(pubkey, ip):
    if not pubkey or not ip:
        return
    os.makedirs(os.path.dirname(WG_CONFIG_PATH), exist_ok=True)
    block = f"\n[Peer]\nPublicKey = {pubkey}\nAllowedIPs = {ip}/32\n"
    with open(WG_CONFIG_PATH, 'a') as f:
        f.write(block)

def ensure_peer_presence(profile):
    pub = profile.get('public_key')
    ip = profile.get('ip')
    if not pub or not ip:
        return
    if not peer_has_allowed_ip(pub, ip):
        run_cmd(['wg', 'set', WG_INTERFACE, 'peer', pub, 'allowed-ips', f'{ip}/32'])
    if not peer_block_exists(pub, ip):
        append_peer_block(pub, ip)

def proxy_user_exists(username):
    if not username:
        return False
    ensure_proxy_files()
    username = username.strip()
    with open(PROXY_USERS, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split(':')
            if len(parts) >= 1 and parts[0] == username:
                return True
    return False

def ensure_proxy_binding(profile, requested_user=None, requested_password=None):
    existing = profile.get('proxy') if profile else None
    if existing and proxy_user_exists(existing.get('username')):
        return existing
    username = requested_user or (existing or {}).get('username')
    password = requested_password or (existing or {}).get('password')
    return add_proxy_user(username, password)

def normalize_ipv4(raw):
    if not raw:
        return None
    candidate = str(raw).strip()
    if not candidate:
        return None
    candidate = candidate.split('/')[0]
    try:
        socket.inet_aton(candidate)
    except OSError:
        raise RuntimeError('invalid ipv4 requested')
    return candidate

def create_device_profile(device_id, payload):
    fallback_name = f"device-{device_id}"
    name = sanitize_peer_name(payload.get('name'), fallback_name)
    cmd = [WG_API, 'add-peer', '--name', name]
    requested_ip = normalize_ipv4(payload.get('ip'))
    if requested_ip:
        cmd += ['--ip', requested_ip]
    config_text = run_cmd(cmd).strip()
    parsed = parse_config_metadata(config_text)
    if not parsed.get('address') or not parsed.get('private_key'):
        raise RuntimeError('failed to parse wireguard config response')
    peer_ip = parsed['address']
    pubkey = find_public_key_by_ip(peer_ip)
    if not pubkey:
        raise RuntimeError('could not determine peer public key')
    profile = {
        'device_id': device_id,
        'peer_name': name,
        'ip': peer_ip,
        'public_key': pubkey,
        'private_key': parsed['private_key'],
        'config': config_text + '\n',
        'proxy': None,
        'created_at': iso_timestamp(),
        'updated_at': iso_timestamp(),
    }
    write_server_log(f"device_profile_created device_id={device_id} ip={peer_ip} pubkey={pubkey[:10]} cfg={mask_private_key(config_text)}")
    ensure_peer_presence(profile)
    return profile

def issue_device_profile(payload):
    raw_device_id = payload.get('device_id') or payload.get('deviceId')
    device_id = sanitize_device_id(raw_device_id)
    if not device_id:
        raise ClientRequestError('device_id required')
    profile = read_device_profile(device_id)
    created = False
    if profile and needs_profile_refresh(profile):
        retire_device_peer(profile)
        profile = None
    if not profile:
        profile = create_device_profile(device_id, payload)
        created = True
    proxy_info = ensure_proxy_binding(profile, payload.get('proxy_user'), payload.get('proxy_password'))
    profile['proxy'] = proxy_info
    ensure_peer_presence(profile)
    profile['updated_at'] = iso_timestamp()
    write_device_profile(profile)
    write_server_log(f"device_profile_issued device_id={device_id} ip={profile.get('ip')} reused={not created} proxy={proxy_info.get('username') if proxy_info else 'n/a'}")
    return profile, created

def tcpdump_capture(interface, duration):
    duration = max(1, int(duration))
    cmd = ['timeout', str(duration), 'tcpdump', '-ni', interface, 'udp', 'port', '53', '-vv', '-c', '50']
    try:
        return run_cmd(cmd, timeout=duration + 10).strip()
    except Exception as exc:
        return f'error: {exc}'

def dns_query_snapshot():
    script = (
        "if command -v dig >/dev/null 2>&1; then "
        "dig +tries=1 +time=3 @1.1.1.1 api.ipify.org && "
        "dig +tries=1 +time=3 @1.0.0.1 api.ipify.org; "
        "else "
        "echo 'dig_not_available'; "
        "fi"
    )
    try:
        return run_cmd(['bash', '-lc', script]).strip()
    except Exception as exc:
        return f'error: {exc}'

def collect_server_diag_snapshot(duration=5):
    duration = max(1, int(duration))
    snapshot = {
        'started_at': iso_timestamp(),
        'duration': duration,
        'tcpdump': {},
    }
    snapshot['tcpdump']['wg0'] = tcpdump_capture('wg0', duration)
    snapshot['tcpdump']['ens3'] = tcpdump_capture('ens3', duration)
    snapshot['dns_query'] = dns_query_snapshot()
    snapshot['ip_route_get_1_1_1_1'] = safe_command_output(['ip', 'route', 'get', '1.1.1.1'])
    snapshot['iptables_forward'] = safe_command_output(['iptables', '-S', 'FORWARD'])
    snapshot['iptables_nat_postrouting'] = safe_command_output(['iptables', '-t', 'nat', '-S', 'POSTROUTING'])
    snapshot['listening_wg_ports'] = safe_command_output(['/bin/sh', '-c', "ss -lunp | grep -E ':443'"])
    wg_brief_cmd = f"(wg show {WG_INTERFACE} | grep -E \"peer|latest handshake|transfer\") || true"
    snapshot['wg_brief'] = safe_command_output(['/bin/sh', '-c', wg_brief_cmd])
    snapshot['wg_full'] = safe_command_output(['wg', 'show', WG_INTERFACE])
    tcpdump_cmd = f"timeout {duration} tcpdump -ni {WG_INTERFACE} udp and port 53 2>&1 || true"
    snapshot['tcpdump_wg_udp53'] = safe_command_output(['/bin/sh', '-c', tcpdump_cmd])
    snapshot['ss_udp_ports'] = safe_command_output(['/bin/sh', '-c', "ss -lun | grep -E ':443'"])
    write_server_log(
        f"server_diag_snapshot duration={duration} wg0_len={len(snapshot['tcpdump']['wg0'])} ens3_len={len(snapshot['tcpdump']['ens3'])}"
    )
    return snapshot

def _default_debug_state():
    return {
        'enabled': False,
        'since': None,
        'client': None,
        'reason': None,
        'updated_at': None
    }

def read_debug_state():
    try:
        if os.path.exists(DEBUG_STATE_FILE):
            with open(DEBUG_STATE_FILE, 'r') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
    except Exception:
        pass
    return _default_debug_state()

def write_debug_state(state):
    try:
        os.makedirs(os.path.dirname(DEBUG_STATE_FILE), exist_ok=True)
        with open(DEBUG_STATE_FILE, 'w') as f:
            json.dump(state, f)
    except Exception:
        pass

def build_debug_response():
    state = read_debug_state()
    try:
        status = ctrl('status').strip()
    except Exception as exc:
        status = f'error: {exc}'
    try:
        tail = ctrl('tail')
    except Exception:
        tail = ''
    response = {
        'enabled': state.get('enabled', False),
        'since': state.get('since'),
        'client': state.get('client'),
        'reason': state.get('reason'),
        'updated_at': state.get('updated_at'),
        'tcpdump_status': status,
        'tail': tail
    }
    return response

def toggle_debug_logging(enable, reason=None, client=None):
    timestamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    action = 'start' if enable else 'stop'
    try:
        ctrl_result = ctrl(action)
    except Exception as exc:
        ctrl_result = f'error: {exc}'
    current = read_debug_state()
    new_state = dict(current)
    new_state['enabled'] = enable
    new_state['reason'] = reason
    new_state['client'] = client
    new_state['updated_at'] = timestamp
    if enable:
        new_state['since'] = timestamp
    else:
        new_state['since'] = None
    write_debug_state(new_state)
    write_server_log(f"debug_logging {action} source={client} reason={reason} ctrl={ctrl_result}")
    response = build_debug_response()
    response['action'] = action
    response['ctrl'] = ctrl_result
    return response

def get_token():
    if not os.path.exists(TOKEN_FILE):
        t = secrets.token_hex(16)
        with open(TOKEN_FILE, 'w') as f:
            f.write(t)
        os.chmod(TOKEN_FILE, 0o600)
        return t
    with open(TOKEN_FILE, 'r') as f:
        return f.read().strip()

def load_probe_ports():
    ports = []
    try:
        with open(PROBE_PORTS_FILE, 'r') as f:
            for line in f:
                entry = line.strip()
                if not entry:
                    continue
                ports.append(int(entry))
    except Exception:
        pass
    return ports or list(DEFAULT_PROBE_PORTS)

def ctrl(action):
    if not os.path.exists(CTRL_SCRIPT):
        raise RuntimeError('tcpdump control script missing')
    res = subprocess.run([CTRL_SCRIPT, action], capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip() or 'command failed')
    return res.stdout.strip()

def run_cmd(cmd, timeout=40):
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        raise RuntimeError('command not found: ' + ' '.join(cmd))
    except subprocess.TimeoutExpired:
        raise RuntimeError('timeout running: ' + ' '.join(cmd))
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip() or 'command failed')
    return res.stdout

def safe_command_output(cmd):
    try:
        return run_cmd(cmd).strip()
    except Exception as exc:
        return f'error: {exc}'

def detect_proxy_host():
    env = os.environ.get('PROXY_HOST')
    if env:
        return env
    try:
        out = subprocess.check_output(['ip', '-4', 'route', 'get', '1.1.1.1'], text=True)
        parts = out.split()
        if 'src' in parts:
            return parts[parts.index('src') + 1]
    except Exception:
        pass
    try:
        addresses = subprocess.check_output(['hostname', '-I'], text=True).strip().split()
        if addresses:
            return addresses[0]
    except Exception:
        pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return '127.0.0.1'

PROXY_HOST = detect_proxy_host()

def ensure_proxy_files():
    os.makedirs(os.path.dirname(PROXY_USERS), exist_ok=True)
    if not os.path.exists(PROXY_USERS):
        with open(PROXY_USERS, 'w') as f:
            f.write('')
        os.chmod(PROXY_USERS, 0o600)

def read_proxy_users():
    ensure_proxy_files()
    users = []
    with open(PROXY_USERS, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split(':')
            if len(parts) >= 3:
                users.append(parts[0])
    return users

def write_proxy_users(entries):
    ensure_proxy_files()
    with open(PROXY_USERS, 'w') as f:
        for user, password in entries.items():
            f.write(f"{user}:CL:{password}\n")
    os.chmod(PROXY_USERS, 0o600)

def add_proxy_user(username=None, password=None):
    ensure_proxy_files()
    entries = {}
    with open(PROXY_USERS, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split(':')
            if len(parts) >= 3:
                entries[parts[0]] = parts[2]
    if username:
        username = username.strip()
    else:
        username = f"px{time.strftime('%m%d%H%M')}{secrets.token_hex(1)}"
    while username in entries:
        username = f"{username}{secrets.token_hex(1)}"
    if password is None:
        password = secrets.token_urlsafe(10)
    entries[username] = password
    write_proxy_users(entries)
    run_cmd(['systemctl', 'restart', PROXY_SERVICE])
    return {
        'username': username,
        'password': password,
        'socks': {
            'scheme': 'socks5',
            'host': PROXY_HOST,
            'port': PROXY_SOCKS_PORT,
        },
        'http': {
            'scheme': 'http',
            'host': PROXY_HOST,
            'port': PROXY_HTTP_PORT,
        }
    }

def remove_proxy_user(username):
    ensure_proxy_files()
    username = username.strip()
    found = False
    entries = {}
    with open(PROXY_USERS, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split(':')
            if len(parts) >= 3:
                if parts[0] == username:
                    found = True
                    continue
                entries[parts[0]] = parts[2]
    if not found:
        raise RuntimeError('user not found')
    write_proxy_users(entries)
    run_cmd(['systemctl', 'restart', PROXY_SERVICE])
    return True

def proxy_status():
    try:
        active = run_cmd(['systemctl', 'is-active', PROXY_SERVICE]).strip()
    except RuntimeError as exc:
        active = f'error: {exc}'
    try:
        out = run_cmd(['ss', '-lnpt'])
        listeners = [
            ln.strip() for ln in out.splitlines()[1:]
            if f":{PROXY_SOCKS_PORT} " in ln or f":{PROXY_HTTP_PORT} " in ln
        ]
    except RuntimeError as exc:
        listeners = [f'error: {exc}']
    return {
        'active': active,
        'host': PROXY_HOST,
        'socks_port': PROXY_SOCKS_PORT,
        'http_port': PROXY_HTTP_PORT,
        'listeners': listeners,
        'users': read_proxy_users(),
    }

class H(BaseHTTPRequestHandler):
    def _json(self, code:int, body:dict):
        data = json.dumps(body).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def _text(self, code:int, body:str):
        data = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def _unauth(self):
        self._json(401, {'ok': False, 'error': 'unauthorized'})

    def _ensure_auth(self):
        token = self.headers.get('X-Auth-Token','')
        return token == get_token()

    def _log_request(self, path, status, extra=None):
        try:
            client = f"{self.client_address[0]}:{self.client_address[1]}"
        except Exception:
            client = 'unknown'
        line = f"{self.command} {path} {status} client={client}"
        if extra:
            line = f"{line} {extra}"
        write_server_log(line)

    def _parse_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            return json.loads(raw.decode('utf-8') or '{}')
        except json.JSONDecodeError as exc:
            raise RuntimeError('invalid json: ' + str(exc))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)
        if not self._ensure_auth():
            self._log_request(path, 'unauthorized')
            self._unauth(); return
        try:
            if path == '/tcpdump/status':
                status = ctrl('status')
                tail = ctrl('tail')
                self._json(200, {'ok': True, 'running': status.strip() == 'running', 'tail': tail})
                self._log_request(path, 'ok', f"running={status.strip()}")
                return
            if path == '/tcpdump/log':
                log = ctrl('log')
                self._text(200, log)
                self._log_request(path, 'ok', 'tcpdump_log')
                return
            if path == '/tcpdump/ens3-443':
                duration = 5
                try:
                    duration = max(1, min(30, int(params.get('duration', ['5'])[0])))
                except ValueError:
                    duration = 5
                cmd = ['timeout', str(duration), 'tcpdump', '-ni', 'ens3', 'udp', 'port', '443', '-c', '200']
                try:
                    output = run_cmd(cmd, timeout=duration + 5)
                    self._json(200, {'ok': True, 'output': output})
                    self._log_request(path, 'ok', f"duration={duration}")
                except Exception as exc:
                    self._json(200, {'ok': False, 'error': str(exc)})
                    self._log_request(path, 'error', f"{exc}")
                return
            if path == '/tcpdump/wg0-icmp':
                host = params.get('host', ['10.6.0.6'])[0]
                count = 20
                cmd = ['timeout', '10', 'tcpdump', '-ni', WG_INTERFACE, 'icmp', 'or', 'host', host, '-c', str(count)]
                try:
                    output = run_cmd(cmd, timeout=15)
                    self._json(200, {'ok': True, 'output': output})
                    self._log_request(path, 'ok', f"host={host} count={count}")
                except Exception as exc:
                    self._json(200, {'ok': False, 'error': str(exc)})
                    self._log_request(path, 'error', f"{exc}")
                return
            if path == '/wg/status':
                summary = run_cmd(['wg', 'show'])
                peers = run_cmd([WG_API, 'list-peers'])
                self._json(200, {'ok': True, 'summary': summary, 'peers': peers})
                self._log_request(path, 'ok', f"peers={len(peers.splitlines()) if isinstance(peers,str) else 'n/a'}")
                return
            if path == '/wg/latest-handshakes':
                latest = run_cmd(['wg', 'show', WG_INTERFACE, 'latest-handshakes'])
                self._json(200, {'ok': True, 'latest': latest})
                self._log_request(path, 'ok', 'latest-handshakes')
                return
            if path == '/wg/peers':
                peers = run_cmd([WG_API, 'list-peers'])
                self._json(200, {'ok': True, 'peers': peers})
                self._log_request(path, 'ok', f"peers={len(peers.splitlines()) if isinstance(peers,str) else 'n/a'}")
                return
            if path == '/system/info':
                info = {
                    'uptime': run_cmd(['uptime']).strip(),
                    'kernel': run_cmd(['uname', '-a']).strip(),
                    'loadavg': run_cmd(['cat', '/proc/loadavg']).strip(),
                    'memory': run_cmd(['free', '-h']).strip(),
                    'disk': run_cmd(['df', '-h', '/']).strip(),
                }
                self._json(200, {'ok': True, 'info': info})
                self._log_request(path, 'ok', 'system_info')
                return
            if path == '/diag/wg-show':
                output = run_cmd(['wg', 'show', WG_INTERFACE])
                self._json(200, {'ok': True, 'output': output})
                self._log_request(path, 'ok', 'wg_show')
                return
            if path == '/diag/ip-rule':
                output = run_cmd(['ip', 'rule', 'show'])
                self._json(200, {'ok': True, 'output': output})
                self._log_request(path, 'ok', 'ip_rule_show')
                return
            if path == '/logs/journal':
                journal = run_cmd(['journalctl', '-u', 'wg-quick@wg0', '-n', '200', '--no-pager'])
                self._text(200, journal)
                self._log_request(path, 'ok', 'journal')
                return
            if path == '/logs/tcpdump':
                log = ctrl('log')
                self._text(200, log)
                self._log_request(path, 'ok', 'tcpdump_log_download')
                return
            if path == '/debug/logging':
                self._json(200, {'ok': True, 'state': build_debug_response()})
                self._log_request(path, 'ok', 'debug_state')
                return
            if path == '/proxy/status':
                status = proxy_status()
                self._json(200, {'ok': True, 'status': status})
                self._log_request(path, 'ok', f"active={status.get('active')} host={status.get('host')}")
                return
            if path == '/proxy/users':
                self._json(200, {'ok': True, 'users': read_proxy_users()})
                self._log_request(path, 'ok', 'users_listed')
                return
            if path == '/probe/ports':
                ports = load_probe_ports()
                self._json(200, {'ok': True, 'ports': ports})
                self._log_request(path, 'ok', f"ports={len(ports)}")
                return
            self._json(404, {'ok': False, 'error': 'not found'})
            self._log_request(path, 'not_found')
        except Exception as e:
            self._json(500, {'ok': False, 'error': str(e)})
            self._log_request(path, 'error', str(e))

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if not self._ensure_auth():
            self._log_request(path, 'unauthorized')
            self._unauth(); return
        try:
            payload = self._parse_json()
        except Exception as e:
            self._json(400, {'ok': False, 'error': str(e)})
            self._log_request(path, 'bad_request', str(e))
            return
        try:
            if path == '/oneclick':
                profile, created = issue_device_profile(payload)
                response = {
                    'ok': True,
                    'device_id': profile.get('device_id'),
                    'name': profile.get('peer_name'),
                    'ip': profile.get('ip'),
                    'public_key': profile.get('public_key'),
                    'config': profile.get('config'),
                    'proxy': profile.get('proxy'),
                    'created_at': profile.get('created_at'),
                    'updated_at': profile.get('updated_at'),
                    'reused': not created
                }
                self._json(200, response)
                self._log_request(path, 'ok', f"device_id={profile.get('device_id')} reused={not created}")
                return
            if path == '/diag/server-snapshot':
                raw_duration = payload.get('duration')
                try:
                    duration_int = int(raw_duration) if raw_duration is not None else 5
                except Exception:
                    duration_int = 5
                duration_int = max(1, min(duration_int, 30))
                snapshot = collect_server_diag_snapshot(duration_int)
                self._json(200, {'ok': True, 'snapshot': snapshot})
                self._log_request(path, 'ok', f"duration={duration_int}")
                return
            if path in ('/tcpdump/start', '/tcpdump/stop'):
                action = 'start' if path.endswith('start') else 'stop'
                message = ctrl(action)
                status = ctrl('status')
                tail = ctrl('tail')
                self._json(200, {'ok': True, 'message': message, 'running': status.strip() == 'running', 'tail': tail})
                self._log_request(path, 'ok', f"action={action}")
                return
            if path == '/debug/logging':
                raw_enabled = payload.get('enabled')
                if isinstance(raw_enabled, bool):
                    enabled = raw_enabled
                elif isinstance(raw_enabled, str):
                    enabled = raw_enabled.strip().lower() in ('1', 'true', 'yes', 'on')
                else:
                    enabled = bool(raw_enabled)
                reason = payload.get('reason')
                client = payload.get('source') or payload.get('client')
                state = toggle_debug_logging(enabled, reason, client)
                self._json(200, {'ok': True, 'state': state})
                self._log_request(path, 'ok', f"enabled={enabled}")
                return
            if path == '/wg/up':
                run_cmd([WG_API, 'up'])
                self._json(200, {'ok': True, 'message': 'wg-quick up'})
                self._log_request(path, 'ok', 'wg_up')
                return
            if path == '/wg/down':
                run_cmd([WG_API, 'down'])
                self._json(200, {'ok': True, 'message': 'wg-quick down'})
                self._log_request(path, 'ok', 'wg_down')
                return
            if path == '/wg/restart':
                try:
                    run_cmd([WG_API, 'down'])
                except Exception:
                    pass
                time.sleep(1)
                run_cmd([WG_API, 'up'])
                self._json(200, {'ok': True, 'message': 'wg-quick restarted'})
                self._log_request(path, 'ok', 'wg_restart')
                return
            if path == '/wg/add-peer':
                name = payload.get('name') or f"user-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
                cmd = [WG_API, 'add-peer', '--name', name]
                if payload.get('ip'):
                    cmd += ['--ip', payload['ip']]
                config = run_cmd(cmd)
                self._json(200, {'ok': True, 'name': name, 'config': config})
                self._log_request(path, 'ok', f"name={name}")
                return
            if path == '/wg/remove-peer':
                pub = payload.get('pubkey')
                if not pub:
                    raise RuntimeError('pubkey is required')
                run_cmd([WG_API, 'remove-peer', pub])
                self._json(200, {'ok': True, 'message': f'removed {pub}'})
                self._log_request(path, 'ok', f"pubkey={pub}")
                return
            if path == '/proxy/add-user':
                user = add_proxy_user(payload.get('username'), payload.get('password'))
                self._json(200, {'ok': True, 'user': user})
                self._log_request(path, 'ok', f"user={user.get('username')}")
                return
            if path == '/proxy/remove-user':
                username = payload.get('username')
                if not username:
                    raise RuntimeError('username required')
                remove_proxy_user(username)
                self._json(200, {'ok': True, 'message': f'removed {username}'})
                self._log_request(path, 'ok', f"user={username}")
                return
            if path == '/proxy/restart':
                run_cmd(['systemctl', 'restart', PROXY_SERVICE])
                self._json(200, {'ok': True, 'status': proxy_status()})
                self._log_request(path, 'ok', 'proxy_restarted')
                return
            if path == '/tests/ping':
                target = payload.get('target')
                if not target:
                    raise RuntimeError('target required')
                count = int(payload.get('count', 4))
                count = max(1, min(count, 10))
                output = run_cmd(['ping', '-c', str(count), target], timeout=20)
                self._text(200, output)
                self._log_request(path, 'ok', f"target={target} count={count}")
                return
            if path == '/tests/curl':
                url = payload.get('url')
                if not url:
                    raise RuntimeError('url required')
                if not url.startswith(('http://', 'https://')):
                    raise RuntimeError('only http(s) allowed')
                method = payload.get('method', 'GET').upper()
                if method not in {'GET', 'HEAD'}:
                    raise RuntimeError('method not allowed')
                args = ['curl', '-sS', '-D', '-', '-o', '-', '-X', method, '--max-time', '20', url]
                output = run_cmd(args, timeout=25)
                self._text(200, output)
                self._log_request(path, 'ok', f"url={url} method={method}")
                return
            self._json(404, {'ok': False, 'error': 'not found'})
            self._log_request(path, 'not_found')
        except ClientRequestError as e:
            self._json(400, {'ok': False, 'error': str(e)})
            self._log_request(path, 'bad_request', str(e))
        except Exception as e:
            self._json(500, {'ok': False, 'error': str(e)})
            self._log_request(path, 'error', str(e))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='0.0.0.0')
    ap.add_argument('--port', type=int, default=8787)
    args = ap.parse_args()
    httpd = HTTPServer((args.host, args.port), H)
    httpd.serve_forever()

if __name__ == '__main__':
    main()
"""
)

UNIT_TEMPLATE = """
[Unit]
Description=WireGuard API HTTP
After=network-online.target
Wants=network-online.target

[Service]
{env_line}ExecStart=/usr/bin/python3 /usr/local/bin/wg_api_http.py --host {api_host} --port {port}
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
"""

def render_unit(env_value):
    env_line = f"    Environment=PUB_ENDPOINT={env_value}\n" if env_value else ""
    return textwrap.dedent(UNIT_TEMPLATE.format(env_line=env_line, api_host=API_HOST, port=PORT))

def main():
    try:
        import paramiko
    except ImportError:
        print("[!] Требуется paramiko: pip install paramiko", file=sys.stderr)
        sys.exit(2)

    print(f"[*] SSH {USER}@{HOST}...")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    sftp = c.open_sftp()
    print("[*] Upload API script...")
    with sftp.open('/usr/local/bin/wg_api_http.py', 'w') as f:
        f.write(SCRIPT)
    sftp.chmod('/usr/local/bin/wg_api_http.py', 0o755)

    if PUB_ENDPOINT_VALUE:
        print(f"[*] PUB_ENDPOINT override: {PUB_ENDPOINT_VALUE}")
    else:
        print("[*] No PUB_ENDPOINT override provided; server will autodetect endpoint/port.")
    unit_content = render_unit(PUB_ENDPOINT_VALUE)
    print("[*] Write systemd unit...")
    with sftp.open('/etc/systemd/system/wg-api-http.service', 'w') as f:
        f.write(unit_content)

    # Ensure token exists and fetch it
    print("[*] Ensure token and start service...")
    for cmd in [
        'python3 - <<PY\nimport os, secrets; p="/etc/wireguard/api_token";\n\n' \
        'open(p,"w").write(secrets.token_hex(16)) if not os.path.exists(p) else None;\n' \
        'import os; os.chmod(p,0o600)\nPY',
        'systemctl daemon-reload',
        'systemctl enable --now wg-api-http.service',
        'touch /var/log/vpn_connection_server_log && chmod 640 /var/log/vpn_connection_server_log || true',
        f'ufw allow {PORT}/tcp || true'
    ]:
        c.exec_command(cmd)

    # Read token
    _, out, err = c.exec_command('cat /etc/wireguard/api_token')
    token = out.read().decode().strip()
    c.close()

    print("[+] API поднят.")
    print(f"URL: http://{HOST}:{PORT}")
    print(f"TOKEN: {token}")

if __name__ == '__main__':
    main()
