import hashlib
import json
import os

from fastapi import APIRouter, HTTPException, Query, Request
from cryptography.fernet import InvalidToken
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from .db import SessionLocal
from .models import Dataset, DynamicSource, SavedConnection
from .shared_data import synchronize_connections, publish_connection, read_config, read_passwords, scopes_for, metadata_identity, metadata_path, read_metadata, file_lock, config_path
from .storage import atomic_json

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
    synchronize_connections()
    with SessionLocal() as session:
        item = session.get(SavedConnection, config['connection_id'])
        if not item or item.config.get('shared_deleted'):
            raise HTTPException(422, '关联连接不存在，请在设置中重新配置')
        result = {**{key: value for key, value in config.items() if key != 'connection_id'}, **item.config}
        if config.get('database'):
            result['database'] = config['database']
        return result


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
    synchronize_connections()
    ranks = {profile.get('shared_id'): index for index, profile in enumerate(read_config().get('profiles', []))}
    with SessionLocal() as session:
        items = [public_connection(item) for item in session.scalars(select(SavedConnection).order_by(SavedConnection.name)) if not item.config.get('shared_deleted')]
        return sorted(items, key=lambda item: ranks.get(item['id'], len(ranks)))


class ConnectionOrder(BaseModel):
    ids: list[str] = Field(max_length=128)


@router.put('/order')
def order_connections(body: ConnectionOrder):
    synchronize_connections()
    path = config_path()
    with file_lock(path.with_suffix('.lock')):
        content = read_config()
        profiles = {profile['shared_id']: profile for profile in content.get('profiles', [])}
        if len(body.ids) != len(set(body.ids)) or set(body.ids) != set(profiles):
            raise HTTPException(409, '连接列表已变化，请刷新后重试')
        content['profiles'] = [profiles[identity] for identity in body.ids]
        atomic_json(path, content)
    return list_connections()


@router.post('', status_code=201)
def create_connection(body: ConnectionRequest):
    synchronize_connections()
    try:
        with SessionLocal.begin() as session:
            if session.scalar(select(func.count()).select_from(SavedConnection)) >= 128:
                raise HTTPException(422, '最多保存 128 个连接')
            item = SavedConnection(name=body.name, config=connection_config(body))
            session.add(item)
            session.flush()
            result = public_connection(item)
        publish_connection(item)
        return result
    except IntegrityError:
        raise HTTPException(409, '连接名称已存在，请使用不同名称') from None


@router.put('/{connection_id}')
def save_connection(connection_id: str, body: ConnectionRequest):
    synchronize_connections()
    try:
        with SessionLocal.begin() as session:
            item = session.get(SavedConnection, connection_id)
            if not item:
                raise HTTPException(404, '连接不存在')
            previous_name = item.name
            result = session.execute(update(SavedConnection).where(SavedConnection.id == connection_id, SavedConnection.version == body.version).values(
                name=body.name, config=connection_config(body, item.config), version=body.version + 1))
            if result.rowcount != 1:
                raise HTTPException(409, '连接已被修改，请重新选择后再试')
            session.refresh(item)
            payload = public_connection(item)
        publish_connection(item, previous_name)
        return payload
    except IntegrityError:
        raise HTTPException(409, '连接名称已存在，请使用不同名称') from None


@router.delete('/{connection_id}', status_code=204)
def delete_connection(connection_id: str):
    synchronize_connections()
    with SessionLocal.begin() as session:
        item = session.get(SavedConnection, connection_id)
        if not item:
            raise HTTPException(404, '连接不存在')
        if any(source.config.get('connection_id') == connection_id for source in session.scalars(select(DynamicSource))):
            raise HTTPException(409, '连接仍被数据集引用，不能删除')
        session.delete(item)
    publish_connection(item, delete=True)


@router.post('/check')
def check_connection(body: ConnectionRequest):
    from .api.datasets import query_slots
    from .query_core import query_rows
    with SessionLocal() as session:
        saved = session.get(SavedConnection, body.id) if body.id else None
        config = connection_config(body, saved.config if saved else None)
    with query_slots:
        query_rows(config, 'SELECT 1')
    return {'connected': True}


def myquery_passwords():
    return read_passwords()


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


def load_object_catalog(connection_id: str, refresh: bool = False):
    synchronize_connections()
    with SessionLocal() as session:
        item = session.get(SavedConnection, connection_id)
        if not item or item.config.get('shared_deleted'):
            raise HTTPException(404, '连接不存在')
        scopes = scopes_for(item.name, item.config['database'])
    objects = []
    for scope in scopes:
        config = resolve_connection({'connection_id': connection_id, 'database': scope['database']})
        identity = metadata_identity(config, scope['schema'])
        path = metadata_path(identity)
        cached = read_metadata(identity) if not refresh else None
        if refresh or cached is None:
            with file_lock(path.with_suffix('.lock')):
                try:
                    cached = read_metadata(identity)
                except (OSError, ValueError, HTTPException):
                    if not refresh:
                        raise
                    cached = None
                if refresh or cached is None:
                    from .storage import atomic_json
                    import time
                    cached = read_object_catalog(connection_id, scope['database'], scope['schema']) | {
                        'identity': identity, 'fetched': int(time.time()),
                        'previous_fields': cached['fields'] if cached else None}
                    atomic_json(path, cached)
        objects.extend({**value, 'database_name': scope['database']} for value in cached['objects'])
    return sorted(objects, key=lambda value: (value['database_name'], value['schema_name'], value['object_name']))


@router.post('/{connection_id}/objects/refresh')
def refresh_objects(connection_id: str):
    return {'count': len(load_object_catalog(connection_id, refresh=True))}


@router.post('/{connection_id}/objects/initialize')
def initialize_objects(connection_id: str):
    return {'count': len(load_object_catalog(connection_id))}


@router.get('/{connection_id}/objects')
def search_objects(connection_id: str, kind: str = Query(default='all', pattern='^(all|table|view|materialized_view)$'), search: str = Query(default='', max_length=255)):
    search = search.strip().lower()
    if not search:
        return []
    return [item for item in load_object_catalog(connection_id)
            if (kind == 'all' or item['kind'] == kind)
            and search in (item['database_name'] + '.' + item['schema_name'] + '.' + item['object_name']).lower()][:100]


def read_object_catalog(connection_id: str, database: str, schema: str):
    from .api.datasets import query_slots
    from .query_core import query_rows
    config = resolve_connection({'connection_id': connection_id, 'database': database})
    with query_slots:
        if config.get('redshift'):
            parameters = (database, schema)
            rows = query_rows(config, """SELECT table_schema, table_name, table_type FROM svv_tables
                WHERE table_catalog = %s AND table_schema = %s""", parameters)
            objects = {(schema, name): {'schema_name': schema, 'object_name': name,
                'kind': 'view' if object_type.upper() == 'VIEW' else 'table'}
                for schema, name, object_type in rows}
            rows = query_rows(config, 'SELECT schema_name, name FROM svv_mv_info WHERE database_name = %s AND schema_name = %s', parameters)
            for schema, name in rows:
                schema, name = schema.rstrip(), name.rstrip()
                objects[schema, name] = {'schema_name': schema, 'object_name': name, 'kind': 'materialized_view'}
            rows = query_rows(config, """SELECT table_name, column_name,
                CASE WHEN LOWER(data_type) IN ('character varying', 'varchar', 'nvarchar', 'character', 'char', 'nchar', 'bpchar') AND character_maximum_length IS NOT NULL
                    THEN CASE WHEN LOWER(data_type) IN ('character varying', 'varchar', 'nvarchar') THEN 'varchar' ELSE 'char' END || '(' || CAST(character_maximum_length AS VARCHAR(20)) || ')'
                    WHEN LOWER(data_type) IN ('numeric', 'decimal') AND numeric_precision IS NOT NULL AND numeric_scale IS NOT NULL
                    THEN data_type || '(' || CAST(numeric_precision AS VARCHAR(20)) || ',' || CAST(numeric_scale AS VARCHAR(20)) || ')' ELSE data_type END,
                is_nullable, column_default,
                CASE LOWER(data_type) WHEN 'smallint' THEN 2 WHEN 'int2' THEN 2 WHEN 'integer' THEN 4 WHEN 'int' THEN 4 WHEN 'int4' THEN 4
                    WHEN 'bigint' THEN 8 WHEN 'int8' THEN 8 WHEN 'real' THEN 4 WHEN 'float4' THEN 4 WHEN 'double precision' THEN 8 WHEN 'float8' THEN 8
                    WHEN 'float' THEN 8 WHEN 'boolean' THEN 1 WHEN 'bool' THEN 1 WHEN 'date' THEN 4 WHEN 'time' THEN 8 WHEN 'time without time zone' THEN 8
                    WHEN 'timetz' THEN 8 WHEN 'time with time zone' THEN 8 ELSE NULL END
                FROM svv_all_columns WHERE database_name = %s AND schema_name = %s ORDER BY table_name, ordinal_position""", parameters)
            fields = [[str(value) if value is not None else None for value in row] for row in rows]
            return {'objects': [value for _, value in sorted(objects.items())], 'fields': fields}
        else:
            query = """SELECT schema_name, object_name, kind FROM (
                SELECT n.nspname AS schema_name, c.relname AS object_name,
                    CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' ELSE 'table' END AS kind
                FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind IN ('r', 'p', 'f', 'v', 'm') AND n.nspname = %s
            ) objects ORDER BY schema_name, object_name"""
        rows = query_rows(config, query, (schema,))
        objects = [{'schema_name': row[0], 'object_name': row[1], 'kind': row[2]} for row in rows]
        rows = query_rows(config, """SELECT c.relname, a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod),
            CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, pg_catalog.pg_get_expr(d.adbin,d.adrelid), t.typlen
            FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
            JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE n.nspname=%s AND c.relkind IN ('r','p','f','v','m') AND a.attnum>0 AND NOT a.attisdropped
            ORDER BY c.relname,a.attnum""", (schema,))
        fields = [[str(value) if value is not None else None for value in row] for row in rows]
        return {'objects': objects, 'fields': fields}
