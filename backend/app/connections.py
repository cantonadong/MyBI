import ctypes
import hashlib
import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from cryptography.fernet import InvalidToken
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from .db import SessionLocal
from .models import Dataset, DynamicSource, SavedConnection
from .settings import PROJECT_ROOT

router = APIRouter(prefix='/api/connections')
CONNECTION_FIELDS = {'host', 'port', 'database', 'user', 'redshift', 'tls', 'trust_server_certificate', 'password'}


class ConnectionRequest(BaseModel):
    id: str | None = None
    version: int = Field(default=1, ge=1)
    name: str = Field(min_length=1, max_length=255)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=5432, ge=1, le=65535)
    database: str = Field(min_length=1, max_length=255)
    user: str = Field(min_length=1, max_length=255)
    password: str | None = Field(default=None, max_length=4096)
    redshift: bool = False
    tls: bool = True
    trust_server_certificate: bool = False

    @field_validator('name', 'host', 'database', 'user', mode='before')
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode='after')
    def valid_text(self):
        if any('\x00' in value for value in (self.name, self.host, self.database, self.user, self.password or '')):
            raise ValueError('连接配置包含无效字符')
        return self


def public_connection(item):
    return {'id': item.id, 'name': item.name, 'version': item.version,
            **{key: value for key, value in item.config.items() if key != 'password'},
            'has_password': bool(item.config.get('password'))}


def connection_config(body, previous=None):
    from .dynamic import cipher
    config = body.model_dump(include=CONNECTION_FIELDS - {'password'})
    if body.password is None:
        if not previous:
            raise HTTPException(422, '请输入数据库密码，允许空密码')
        config['password'] = previous['password']
    else:
        config['password'] = cipher().encrypt(body.password.encode()).decode()
    return config


def resolve_connection(config):
    if not config.get('connection_id'):
        return config
    with SessionLocal() as session:
        item = session.get(SavedConnection, config['connection_id'])
        if not item:
            raise HTTPException(422, '关联连接不存在，请在设置中重新配置')
        return {**{key: value for key, value in config.items() if key != 'connection_id'}, **item.config}


def migrate_connections():
    from .dynamic import cipher
    def identity(config):
        values = {key: value for key, value in config.items() if key in CONNECTION_FIELDS}
        try:
            values['password'] = cipher().decrypt(values['password'].encode()).decode()
        except (InvalidToken, OSError, ValueError, KeyError):
            pass
        return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).digest()
    with SessionLocal.begin() as session:
        existing = list(session.scalars(select(SavedConnection)))
        known = {identity(item.config): item for item in existing}
        names = {item.name for item in existing}
        for source in session.scalars(select(DynamicSource)):
            if source.config.get('connection_id'):
                continue
            config = {key: value for key, value in source.config.items() if key in CONNECTION_FIELDS}
            config.setdefault('redshift', False)
            key = identity(config)
            item = known.get(key)
            if item is None:
                dataset = session.get(Dataset, source.dataset_id)
                base = (dataset.name if dataset else config.get('host', 'Connection'))[:240]
                name, number = base, 1
                while name in names:
                    number += 1
                    name = f'{base} ({number})'
                item = SavedConnection(name=name, config=config)
                session.add(item)
                session.flush()
                names.add(name)
                known[key] = item
            source.config = {key: value for key, value in source.config.items() if key not in CONNECTION_FIELDS} | {'connection_id': item.id}


@router.get('')
def list_connections():
    with SessionLocal() as session:
        return [public_connection(item) for item in session.scalars(select(SavedConnection).order_by(SavedConnection.name))]


@router.post('', status_code=201)
def create_connection(body: ConnectionRequest):
    try:
        with SessionLocal.begin() as session:
            if session.scalar(select(func.count()).select_from(SavedConnection)) >= 128:
                raise HTTPException(422, '最多保存 128 个连接')
            item = SavedConnection(name=body.name, config=connection_config(body))
            session.add(item)
            session.flush()
            return public_connection(item)
    except IntegrityError:
        raise HTTPException(409, '连接名称已存在，请使用不同名称') from None


@router.put('/{connection_id}')
def save_connection(connection_id: str, body: ConnectionRequest):
    try:
        with SessionLocal.begin() as session:
            item = session.get(SavedConnection, connection_id)
            if not item:
                raise HTTPException(404, '连接不存在')
            result = session.execute(update(SavedConnection).where(SavedConnection.id == connection_id, SavedConnection.version == body.version).values(
                name=body.name, config=connection_config(body, item.config), version=body.version + 1))
            if result.rowcount != 1:
                raise HTTPException(409, '连接已被修改，请重新选择后再试')
            session.refresh(item)
            return public_connection(item)
    except IntegrityError:
        raise HTTPException(409, '连接名称已存在，请使用不同名称') from None


@router.delete('/{connection_id}', status_code=204)
def delete_connection(connection_id: str):
    with SessionLocal.begin() as session:
        item = session.get(SavedConnection, connection_id)
        if not item:
            raise HTTPException(404, '连接不存在')
        if any(source.config.get('connection_id') == connection_id for source in session.scalars(select(DynamicSource))):
            raise HTTPException(409, '连接仍被数据集引用，不能删除')
        session.delete(item)


@router.post('/check')
def check_connection(body: ConnectionRequest):
    from .api.datasets import query_slots
    from .dynamic import database_connection
    with SessionLocal() as session:
        saved = session.get(SavedConnection, body.id) if body.id else None
        config = connection_config(body, saved.config if saved else None)
    with query_slots, database_connection(config) as (connection, _, _):
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
    return {'connected': True}


def myquery_passwords():
    path = PROJECT_ROOT.parent / 'MyQuery' / 'passwords.dat'
    if not path.is_file():
        return {}
    if path.stat().st_size > 1024 * 1024:
        raise ValueError()
    class Blob(ctypes.Structure):
        _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    data = path.read_bytes()
    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source, target = Blob(len(data), buffer), Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(Blob)]
    crypt.CryptUnprotectData.restype = ctypes.c_int
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise OSError(ctypes.get_last_error())
    try:
        return json.loads(ctypes.string_at(target.data, target.size).decode('utf-8'))
    finally:
        ctypes.memset(target.data, 0, target.size)
        kernel.LocalFree(target.data)


@router.post('/import-myquery')
def import_myquery(request: Request):
    from .api.sources import myquery_connections
    profiles = myquery_connections(request)
    try:
        passwords = myquery_passwords() if os.name == 'nt' else {}
        if not isinstance(passwords, dict):
            raise ValueError()
    except (OSError, ValueError):
        raise HTTPException(422, '无法读取 MyQuery 已保存的密码，请确认使用同一 Windows 用户') from None
    imported = 0
    try:
        with SessionLocal.begin() as session:
            names = set(session.scalars(select(SavedConnection.name)))
            for profile in profiles:
                if profile['name'] in names:
                    continue
                if len(names) >= 128:
                    raise HTTPException(422, '最多保存 128 个连接')
                body = ConnectionRequest(**profile, password=passwords.get(profile['name'], ''))
                session.add(SavedConnection(name=body.name, config=connection_config(body)))
                names.add(body.name)
                imported += 1
    except IntegrityError:
        raise HTTPException(409, '连接列表已被修改，请重新加载') from None
    return {'imported': imported}


@router.get('/{connection_id}/objects')
def search_objects(connection_id: str, kind: str = Query(default='all', pattern='^(all|table|view|materialized_view)$'), search: str = Query(default='', max_length=255)):
    from .api.datasets import query_slots
    from .dynamic import database_connection
    with query_slots, database_connection({'connection_id': connection_id}) as (connection, _, redshift):
        if redshift:
            query = """SELECT schema_name, object_name, kind FROM (
                SELECT t.table_schema AS schema_name, t.table_name AS object_name,
                    CASE WHEN UPPER(t.table_type) = 'VIEW' THEN 'view' ELSE 'table' END AS kind
                FROM svv_tables t WHERE table_catalog = current_database()
                    AND table_schema NOT IN ('pg_catalog', 'information_schema')
                    AND NOT EXISTS (SELECT 1 FROM svv_mv_info m WHERE m.database_name = current_database() AND m.schema_name = t.table_schema AND m.name = t.table_name)
                UNION ALL SELECT schema_name, name, 'materialized_view' FROM svv_mv_info WHERE database_name = current_database()
            ) objects WHERE (%s = 'all' OR kind = %s) AND strpos(lower(schema_name || '.' || object_name), lower(%s)) > 0
            ORDER BY schema_name, object_name LIMIT 100"""
        else:
            query = """SELECT schema_name, object_name, kind FROM (
                SELECT n.nspname AS schema_name, c.relname AS object_name,
                    CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' ELSE 'table' END AS kind
                FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind IN ('r', 'p', 'f', 'v', 'm') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                    AND n.nspname NOT LIKE 'pg_toast%%' AND has_table_privilege(c.oid, 'SELECT')
            ) objects WHERE (%s = 'all' OR kind = %s) AND strpos(lower(schema_name || '.' || object_name), lower(%s)) > 0
            ORDER BY schema_name, object_name LIMIT 100"""
        with connection.cursor() as cursor:
            cursor.execute(query, (kind, kind, search.strip()))
            return [{'schema_name': row[0].rstrip() if redshift else row[0], 'object_name': row[1].rstrip() if redshift else row[1], 'kind': row[2]} for row in cursor.fetchall()]
