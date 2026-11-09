import ctypes
import json
import os
import shutil
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from .db import SessionLocal
from .models import DynamicSource, SavedConnection
from .settings import PROJECT_ROOT, settings
from .storage import atomic_json

_locks = {}
_stamp = None
PROFILE_FIELDS = {'host', 'port', 'database', 'user', 'redshift', 'tls', 'trust_server_certificate'}


def config_path():
    return Path(os.getenv('APPDATA', str(settings.snapshot_root.parent))) / 'MyDataTools' / 'connections.json'


@contextmanager
def file_lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with _locks.setdefault(str(path), RLock()), path.open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == 'nt':
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


def read_config():
    path = config_path()
    if not path.exists():
        legacy = path.parent.parent / 'SqlDesk' / path.name
        content = json.loads(legacy.read_text(encoding='utf-8')) if legacy.exists() else {'profiles': [], 'browser_scopes': []}
        atomic_json(path, content)
    if path.stat().st_size > 1024 * 1024:
        raise ValueError('Connection configuration exceeds 1 MiB')
    content = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(content, dict) or not isinstance(content.get('profiles', []), list) or len(content.get('profiles', [])) > 128:
        raise ValueError('Invalid shared connections')
    return content


def protect(data, encrypt=False):
    class Blob(ctypes.Structure):
        _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source, target = Blob(len(data), buffer), Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if encrypt:
        function = crypt.CryptProtectData
        arguments = (ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    else:
        function = crypt.CryptUnprotectData
        arguments = (ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    function.restype = ctypes.c_int
    if not function(*arguments):
        raise OSError(ctypes.get_last_error())
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.memset(target.data, 0, target.size)
        kernel.LocalFree(target.data)


def read_passwords():
    path = config_path().with_name('passwords.dat')
    if not path.exists():
        legacy = PROJECT_ROOT.parent / 'MyQuery' / 'passwords.dat'
        if legacy.is_file():
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(legacy, path)
        else:
            return {}
    if path.stat().st_size > 1024 * 1024:
        raise ValueError('Encrypted password file exceeds 1 MiB')
    passwords = json.loads(protect(path.read_bytes()).decode('utf-8'))
    if not isinstance(passwords, dict) or any(not isinstance(key, str) or not isinstance(value, str) for key, value in passwords.items()):
        raise ValueError('Invalid encrypted passwords')
    return passwords


def write_passwords(passwords):
    path = config_path().with_name('passwords.dat')
    candidate = path.with_name(f'.{uuid4()}.tmp')
    try:
        with candidate.open('wb') as stream:
            stream.write(protect(json.dumps(passwords, ensure_ascii=False).encode('utf-8'), encrypt=True))
            stream.flush()
            os.fsync(stream.fileno())
        candidate.replace(path)
    finally:
        candidate.unlink(missing_ok=True)


def synchronize_connections():
    global _stamp
    from .connections import ConnectionRequest
    from .dynamic import cipher
    path = config_path()
    password_path = path.with_name('passwords.dat')
    stamp = tuple((p.stat().st_mtime_ns, p.stat().st_size) if p.exists() else None for p in (path, password_path))
    if stamp == _stamp:
        return
    with file_lock(path.with_suffix('.lock')), file_lock(path.with_name('passwords.lock')):
        content, passwords = read_config(), read_passwords()
        marker = settings.snapshot_root.parent / 'shared-connections.json'
        tracked = set(json.loads(marker.read_text(encoding='utf-8'))) if marker.exists() else set()
        profiles = content.setdefault('profiles', [])
        with SessionLocal.begin() as session:
            existing = list(session.scalars(select(SavedConnection)))
            by_id = {item.id: item for item in existing}
            names = {item.name for item in existing} | {profile['name'] for profile in profiles}
            def preserve_name(item):
                number = 1
                name = f'{item.name[:220]} (MyBI)'
                while name in names:
                    number += 1
                    name = f'{item.name[:220]} (MyBI {number})'
                names.add(name)
                item.name = name
            for item in existing:
                if not item.config.get('shared_deleted') and item.id not in tracked:
                    collision = next((profile for profile in profiles if profile['name'] == item.name), None)
                    if collision:
                        other = ConnectionRequest.model_validate(collision).model_dump()
                        if all(item.config.get(key) == other[key] for key in ('host', 'port', 'database', 'user', 'redshift')):
                            continue
                        preserve_name(item)
                    profiles.append({'name': item.name, 'shared_id': item.id, **{key: value for key, value in item.config.items() if key in PROFILE_FIELDS}})
                    passwords[item.name] = cipher().decrypt(item.config['password'].encode()).decode()
            session.flush()
            by_name = {item.name: item for item in existing}
            active = set()
            for profile in profiles:
                body = ConnectionRequest.model_validate(profile)
                item = by_id.get(profile.get('shared_id'))
                candidate = by_name.get(body.name)
                if item is None and candidate:
                    if candidate.config.get('shared_deleted') or profile.get('shared_id') and profile['shared_id'] != candidate.id and candidate.id in tracked:
                        preserve_name(candidate)
                        session.flush()
                        by_name.pop(body.name, None)
                    else:
                        item = candidate
                identity = item.id if item else profile.get('shared_id') or str(uuid4())
                profile['shared_id'] = identity
                config = body.model_dump(include=PROFILE_FIELDS)
                password = passwords.get(body.name)
                if password is None and item:
                    password = cipher().decrypt(item.config['password'].encode()).decode()
                    passwords[body.name] = password
                password = password or ''
                encrypted = item.config.get('password') if item else None
                if not encrypted or cipher().decrypt(encrypted.encode()).decode() != password:
                    encrypted = cipher().encrypt(password.encode()).decode()
                config['password'] = encrypted
                if item is None:
                    item = SavedConnection(id=identity, name=body.name, config=config)
                    session.add(item)
                elif item.config != config or item.name != body.name:
                    item.name, item.config, item.version = body.name, config, item.version + 1
                active.add(identity)
            for item in existing:
                if item.id in tracked - active:
                    if any(source.config.get('connection_id') == item.id for source in session.scalars(select(DynamicSource))):
                        item.config = {**item.config, 'shared_deleted': True}
                    else:
                        session.delete(item)
        write_passwords(passwords)
        atomic_json(path, content)
        atomic_json(marker, sorted(active))
        _stamp = tuple((p.stat().st_mtime_ns, p.stat().st_size) for p in (path, password_path))


def publish_connection(item, previous_name=None, delete=False):
    global _stamp
    from .dynamic import cipher
    path = config_path()
    with file_lock(path.with_suffix('.lock')), file_lock(path.with_name('passwords.lock')):
        content, passwords = read_config(), read_passwords()
        profiles = content.setdefault('profiles', [])
        previous = next((profile for profile in profiles if profile.get('shared_id') == item.id or profile['name'] == (previous_name or item.name)), None)
        if delete:
            if previous:
                profiles.remove(previous)
        else:
            profile = {'name': item.name, 'shared_id': item.id, **{key: value for key, value in item.config.items() if key in PROFILE_FIELDS}}
            if previous:
                previous.update(profile)
            else:
                profiles.append(profile)
            passwords[item.name] = cipher().decrypt(item.config['password'].encode()).decode()
        for scope in list(content.get('browser_scopes', [])):
            if scope['profile'] == (previous_name or item.name):
                if delete:
                    content['browser_scopes'].remove(scope)
                else:
                    scope['profile'] = item.name
        if delete or previous_name and previous_name != item.name:
            passwords.pop(previous_name or item.name, None)
        write_passwords(passwords)
        atomic_json(path, content)
        _stamp = None


def scopes_for(name, database):
    scopes = [scope for scope in read_config().get('browser_scopes', []) if scope.get('profile') == name]
    if any(not isinstance(scope.get(key), str) or not scope[key] or len(scope[key]) > 255 or '\x00' in scope[key]
           for scope in scopes for key in ('database', 'schema')):
        raise HTTPException(422, '共享浏览范围无效，请在 MyQuery 中重新配置')
    return scopes or [{'profile': name, 'database': database, 'schema': 'public'}]


def metadata_identity(config, schema):
    return [config.get('redshift', False), config['host'], config['port'], config['user'], config['database'], schema]


def metadata_path(identity):
    value = 14695981039346656037
    for byte in json.dumps(identity, separators=(',', ':'), ensure_ascii=False).encode('utf-8'):
        value = ((value ^ byte) * 1099511628211) & ((1 << 64) - 1)
    return Path(os.getenv('LOCALAPPDATA', str(settings.snapshot_root.parent))) / 'MyDataTools' / 'metadata' / f'{value:016x}.json'


def read_metadata(identity):
    path = metadata_path(identity)
    if not path.exists():
        return None
    if path.stat().st_size > 64 * 1024 * 1024:
        raise HTTPException(422, '共享对象缓存过大，请刷新')
    content = json.loads(path.read_text(encoding='utf-8'))
    if content.get('identity') != identity or not isinstance(content.get('objects'), list) or not isinstance(content.get('fields'), list) or any(
            not isinstance(item, dict) or item.get('schema_name') != identity[-1] or not isinstance(item.get('object_name'), str)
            or item.get('kind') not in {'table', 'view', 'materialized_view'} for item in content.get('objects', [])) or any(
            not isinstance(row, list) or len(row) != 6 or any(value is not None and not isinstance(value, str) for value in row)
            for row in content.get('fields', [])):
        raise HTTPException(422, '共享对象缓存无效，请刷新')
    return content
