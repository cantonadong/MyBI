import ipaddress
import re
import socket
import time
from threading import Lock, Thread
from urllib.parse import urlsplit, urlunsplit
from urllib.request import ProxyHandler, build_opener

import uvicorn
import duckdb
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from .api.dashboards import get_published
from .api.datasets import ViewQuery, view_query
from .settings import PROJECT_ROOT


class PublicSettings(BaseModel):
    enabled: bool = False
    port: int = Field(default=8001, ge=1, le=65535, strict=True)
    base_url: str = Field(default='', max_length=2048)

    @field_validator('port')
    @classmethod
    def public_port(cls, value):
        if value == 8000:
            raise ValueError('端口不能与本地管理端口 8000 相同')
        return value

    @field_validator('base_url')
    @classmethod
    def address(cls, value):
        value = value.strip()
        if not value:
            return ''
        if '://' not in value:
            value = 'http://' + value
        try:
            parts = urlsplit(value)
            port = parts.port
            if parts.scheme not in {'http', 'https'} or not parts.hostname or parts.username is not None or parts.password is not None or parts.path not in {'', '/'} or parts.query or parts.fragment or any(character.isspace() for character in value) or (port is not None and port < 1):
                raise ValueError()
            hostname = parts.hostname.encode('idna').decode()
            if ':' in hostname:
                ipaddress.IPv6Address(hostname)
            elif not all(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label) for label in hostname.rstrip('.').split('.')):
                raise ValueError()
        except (ValueError, UnicodeError):
            raise ValueError('请输入有效的 IP 或域名地址，可包含协议和端口')
        return urlunsplit((parts.scheme, parts.netloc, '', '', ''))


config_path = PROJECT_ROOT / 'data' / 'public-access.json'
web_dist = PROJECT_ROOT / 'frontend' / 'dist'
public_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
router = APIRouter(prefix='/api/public-access')
lock = Lock()
configuration = PublicSettings()
server = None
thread = None
listener = None
last_error = ''
ip_cache = (0.0, '')


def public_report(report_id):
    report = get_published(report_id)
    document = report['document']
    document['datasets'] = [{key: value for key, value in source.items() if key in {'id', 'name', 'snapshot_id', 'schema', 'field_formats', 'version', 'data_as_of', 'updated_at', 'annotation_fields'}} | ({'dynamic': {'schedule': {'enabled': False}}} if source.get('dynamic') is not None else {}) for source in document.get('datasets', [])]
    document.pop('refreshSchedule', None)
    return report


@public_app.exception_handler(ValueError)
@public_app.exception_handler(duckdb.Error)
async def invalid_value(request: Request, error: ValueError):
    return JSONResponse(status_code=422, content={'detail': 'Invalid report query'})


@public_app.get('/api/public/{report_id}/published')
def published(report_id: str):
    return public_report(report_id)


@public_app.get('/api/public/{report_id}/datasets')
def datasets(report_id: str):
    return public_report(report_id)['document'].get('datasets', [])


@public_app.post('/api/public/{report_id}/datasets/{dataset_id}/view-query')
def query(report_id: str, dataset_id: str, body: ViewQuery):
    source = next((source for source in public_report(report_id)['document'].get('datasets', []) if source['id'] == dataset_id), None)
    if not source:
        raise HTTPException(404, 'Dataset not found')
    if 'dynamic' not in source and body.snapshot_id and body.snapshot_id != source['snapshot_id']:
        raise HTTPException(403, 'Snapshot does not belong to this published report')
    return view_query(dataset_id, body.model_copy(update={'snapshot_id': source['snapshot_id']}))


@public_app.get('/view/{report_id}', response_class=HTMLResponse)
def page(report_id: str):
    public_report(report_id)
    return HTMLResponse((web_dist / 'index.html').read_text(encoding='utf-8').replace('<html', '<html data-public-view="true"', 1), headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})


for directory in ('assets', 'import-icons'):
    if (web_dist / directory).is_dir():
        public_app.mount('/' + directory, StaticFiles(directory=web_dist / directory), name=directory)


@public_app.get('/{filename}')
def static_file(filename: str):
    if filename not in {'favicon.png', 'favicon.svg', 'dialogue_bubble.svg'}:
        raise HTTPException(404)
    return FileResponse(web_dist / filename)


def status():
    return {**configuration.model_dump(), 'running': bool(server and server.started and thread and thread.is_alive()), 'listening_port': configuration.port, 'error': last_error}


def access_settings(refresh_ip=False):
    global ip_cache
    with lock:
        result = status()
    checked_at, public_ip = ip_cache
    if refresh_ip or time.monotonic() - checked_at >= (60 if public_ip else 10):
        try:
            with build_opener(ProxyHandler({})).open('https://api.ipify.org', timeout=3) as response:
                address = ipaddress.IPv4Address(response.read(64).decode('ascii').strip())
            public_ip = str(address) if address.is_global else ''
        except (OSError, ValueError, UnicodeError):
            public_ip = ''
        ip_cache = (time.monotonic(), public_ip)
    base_url = result['base_url']
    if base_url:
        parts = urlsplit(base_url)
        if parts.port is None and parts.scheme == 'http' and result['port'] != 80:
            base_url = urlunsplit((parts.scheme, parts.netloc + ':' + str(result['port']), '', '', ''))
    elif public_ip:
        base_url = f"http://{public_ip}:{result['port']}"
    return {**result, 'public_ip': public_ip, 'access_url': base_url}


def stop_listener():
    global server, thread, listener
    if server:
        server.should_exit = True
    if thread:
        thread.join(timeout=35)
        if thread.is_alive():
            raise RuntimeError('只读服务停止超时')
    if listener:
        listener.close()
    server = thread = listener = None


def start_listener(sock):
    global server, thread, listener
    listener = sock
    server = uvicorn.Server(uvicorn.Config(public_app, log_level='warning', lifespan='off', timeout_graceful_shutdown=30, proxy_headers=False))
    thread = Thread(target=server.run, kwargs={'sockets': [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 5
    while thread.is_alive() and not server.started and time.monotonic() < deadline:
        time.sleep(0.02)
    if not server.started:
        stop_listener()
        raise RuntimeError('只读服务启动失败')


def bind(port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        sock.bind(('0.0.0.0', port))
        return sock
    except OSError:
        sock.close()
        raise


def startup():
    global configuration, last_error
    with lock:
        try:
            if config_path.exists():
                configuration = PublicSettings.model_validate_json(config_path.read_text(encoding='utf-8'))
            if configuration.enabled:
                start_listener(bind(configuration.port))
        except (OSError, ValueError, RuntimeError) as error:
            last_error = str(error)


def shutdown():
    with lock:
        stop_listener()


@router.get('')
def get_settings(refresh_ip: bool = False):
    return access_settings(refresh_ip)


@router.put('')
def save_settings(body: PublicSettings):
    global configuration, last_error
    with lock:
        previous = configuration
        previous_running = status()['running']
        restart = body.enabled and (not previous_running or body.port != previous.port)
        sock = None
        switched = False
        try:
            if restart:
                sock = bind(body.port)
            config_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = config_path.with_suffix('.tmp')
            temporary.write_text(body.model_dump_json(), encoding='utf-8')
            if restart or not body.enabled:
                switched = True
                stop_listener()
            if restart:
                start_listener(sock)
                sock = None
            temporary.replace(config_path)
            configuration, last_error = body, ''
        except (OSError, RuntimeError) as error:
            if sock:
                sock.close()
            if switched:
                stop_listener()
                if previous_running:
                    try:
                        start_listener(bind(previous.port))
                    except (OSError, RuntimeError) as restore_error:
                        last_error = str(restore_error)
            raise HTTPException(409, '无法启动或保存只读服务，请检查端口占用和文件权限') from error
    return access_settings()
