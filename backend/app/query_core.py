import ctypes
import json
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Event, Thread
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

from cryptography.fernet import InvalidToken
from fastapi import HTTPException

from .settings import PROJECT_ROOT, settings


query_cancel = ContextVar('query_cancel', default=None)


@lru_cache(maxsize=1)
def library():
    try:
        core = ctypes.CDLL(str(PROJECT_ROOT / 'myquery_core.dll'))
        core.myquery_core_version.argtypes = []
        core.myquery_core_version.restype = ctypes.c_uint32
        if core.myquery_core_version() != 2:
            raise OSError('Unsupported query core ABI')
        core.myquery_core_execute.argtypes = [ctypes.c_char_p]
        core.myquery_core_execute.restype = ctypes.c_void_p
        core.myquery_core_free.argtypes = [ctypes.c_void_p]
        core.myquery_core_free.restype = None
        return core
    except (OSError, AttributeError):
        raise HTTPException(503, '共享查询模块不可用，请重新构建或安装 MyBI') from None


@contextmanager
def query_result(config, statement, parameters=(), typed=False, read_only=True):
    from .connections import resolve_connection
    from .dynamic import cipher

    cancellation = query_cancel.get()
    if cancellation and cancellation.is_set():
        raise HTTPException(499, '查询已取消')
    config = resolve_connection(config)
    if config.get('sync_requires_connection'):
        raise HTTPException(422, '同步的数据源需要在本机配置数据库连接')
    try:
        password = cipher().decrypt(config['password'].encode()).decode()
    except (InvalidToken, ValueError, OSError):
        raise HTTPException(422, '无法解密数据库密码，请重新填写密码或恢复原密钥') from None
    started = perf_counter()
    core = library()
    with TemporaryDirectory(prefix='mybi-query-') as directory:
        output = Path(directory) / 'rows.jsonl'
        cancel_file = Path(directory) / 'cancel'
        finished = Event()
        def watch_cancel():
            while not finished.wait(0.1):
                if cancellation.is_set():
                    cancel_file.touch()
                    return
        watcher = Thread(target=watch_cancel, daemon=True) if cancellation else None
        if watcher:
            watcher.start()
        request = {
            'profile': {'name': 'MyBI', **{key: config[key] for key in ('host', 'port', 'database', 'user', 'tls', 'redshift')}, 'trust_server_certificate': config.get('trust_server_certificate', False)},
            'password': password, 'sql': statement, 'parameters': list(parameters), 'typed': typed, 'read_only': read_only,
            'cancel_file': str(cancel_file), 'output': str(output), 'timeout_seconds': settings.dynamic_timeout_seconds,
            'max_rows': settings.dynamic_max_rows, 'max_bytes': settings.max_upload_bytes,
        }
        try:
            # Typed mode prepares the SQL first; multi-statement scripts (e.g. writes followed by SELECT) cannot be
            # prepared, so retry untyped. Nothing has executed when prepare fails, so the retry cannot repeat writes.
            for use_types in ([True, False] if typed else [typed]):
                request['typed'] = use_types
                result = core.myquery_core_execute(json.dumps(request, ensure_ascii=False).encode('utf-8'))
                if not result:
                    raise HTTPException(503, '共享查询模块不可用，请重新构建或安装 MyBI')
                try:
                    payload = json.loads(ctypes.string_at(result).decode('utf-8'))
                finally:
                    core.myquery_core_free(result)
                error = str(payload.get('error', ''))
                if not (use_types and ('42601' in error or 'syntax error' in error.lower() or 'multiple commands' in error.lower())):
                    break
            if payload.get('error') == 'CANCELLED':
                raise HTTPException(499, '查询已取消')
            if error := payload.get('error'):
                limit = error in {'LIMIT_ROWS', 'LIMIT_ROW', 'LIMIT_RESULT', 'LIMIT_COLUMNS'}
                message = '查询结果超过数据集大小限制，请缩小查询范围' if limit else '查询超时，请缩小查询范围' if error == 'TIMEOUT' else '动态数据集查询只能返回一个结果集' if error == 'MULTIPLE_RESULTS' else '查询结果为空，请检查 SQL 或数据源' if error == 'NO_RESULT' else error
                raise HTTPException(413 if limit else 422, {'code': 'source_query_failed', 'message': message, 'duration_seconds': perf_counter() - started})
            with output.open(encoding='utf-8') as rows:
                yield payload, (json.loads(line) for line in rows)
        finally:
            finished.set()
            if watcher:
                watcher.join()



def query_rows(config, statement, parameters=()):
    with query_result(config, statement, parameters) as (_, rows):
        return list(rows)
