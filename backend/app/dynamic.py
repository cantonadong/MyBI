from datetime import datetime, time, timedelta, timezone
from contextlib import closing, contextmanager
import hashlib
import json
import logging
import os
import ssl
import time as time_module
from pathlib import Path
from threading import Timer
from tempfile import TemporaryDirectory
from time import perf_counter
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
import psycopg
import psycopg2
import psycopg2.sql
import pyarrow.parquet as pq
from psycopg import sql
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import or_, select, update

from .db import SessionLocal
from .connections import resolve_connection
from .imports.delimited import Field as Column, TabularPreview, text_field
from .models import Dataset, DatasetSnapshot, DynamicSource
from .settings import settings
from .storage import atomic_copy, atomic_json, dataset_dir, rollback_files


class Schedule(BaseModel):
    enabled: bool = False
    time: str = '06:00'
    timezone: str = 'UTC'

    @model_validator(mode='after')
    def valid_schedule(self):
        try:
            parsed = time.fromisoformat(self.time)
            if parsed.tzinfo or len(self.time) != 5:
                raise ValueError()
            ZoneInfo(self.timezone)
        except (ValueError, ZoneInfoNotFoundError):
            raise ValueError('定时任务需要有效的时间和时区')
        return self


class SourceConfig(BaseModel):
    annotation_order: list[str] = Field(default_factory=list)
    connection_id: str | None = Field(default=None, min_length=1, max_length=36)
    redshift: bool = False
    host: str = Field(default="", max_length=255)
    port: int = Field(default=5432, ge=1, le=65535)
    database: str = Field(default="", max_length=255)
    user: str = Field(default="", max_length=255)
    password: str | None = Field(default=None, max_length=4096)
    tls: bool = True
    trust_server_certificate: bool = False
    mode: str = Field(default='sql', pattern='^(sql|table|view|materialized_view)$')
    sql: str = Field(default='', max_length=100000)
    schema_name: str = Field(default='public', max_length=255)
    object_name: str = Field(default='', max_length=255)
    schedule: Schedule = Field(default_factory=Schedule)

    @model_validator(mode='after')
    def valid_query(self):
        if not self.connection_id and not all(value.strip() for value in (self.host, self.database, self.user)):
            raise ValueError('请选择已保存的连接')
        if self.mode == 'sql' and not self.sql.strip():
            raise ValueError('请输入查询 SQL')
        if self.mode != 'sql' and (not self.schema_name.strip() or not self.object_name.strip()):
            raise ValueError('请输入表或视图名称')
        if any('\x00' in value for value in [self.host, self.database, self.user, self.sql, self.schema_name, self.object_name, self.password or '']):
            raise ValueError('连接配置包含无效字符')
        return self


class SourceRequest(SourceConfig):
    name: str = Field(min_length=1, max_length=255)
    version: int | None = Field(default=None, ge=1)
    preview_id: str | None = None
    overrides: dict[str, str] = Field(default_factory=dict)
    renames: dict[str, str] = Field(default_factory=dict)
    formats: dict[str, dict] = Field(default_factory=dict)
    field_order: list[str] = Field(default_factory=list)
    confirm_conversion: bool = False
    annotation_fields: dict[str, str] | None = None


def utc_now():
    return datetime.now(timezone.utc)


def utc_iso(value):
    return value.replace(tzinfo=timezone.utc).isoformat() if value else None


def next_run(schedule: dict, after: datetime | None = None):
    plan = Schedule.model_validate(schedule)
    if not plan.enabled:
        return None
    local = (after or utc_now()).astimezone(ZoneInfo(plan.timezone))
    hour, minute = map(int, plan.time.split(':'))
    target = local.replace(hour=hour, minute=minute, second=0, microsecond=0, fold=0)
    if target <= local:
        target = datetime.combine(local.date() + timedelta(days=1), time(hour, minute), local.tzinfo)
    return target.astimezone(timezone.utc)


def cipher():
    key = os.getenv('MYBI_SECRET_KEY')
    if key:
        return Fernet(key.encode('ascii'))
    path = settings.secret_key_file
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.is_file():
        candidate = path.with_name(f'.{path.name}.{uuid4()}.tmp')
        try:
            descriptor = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(Fernet.generate_key())
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(candidate, path)
            except FileExistsError:
                pass
        finally:
            candidate.unlink(missing_ok=True)
    return Fernet(path.read_bytes().strip())


def stored_config(request: SourceConfig, previous: dict | None = None):
    if request.connection_id:
        config = request.model_dump(include={'connection_id', 'database', 'mode', 'sql', 'schema_name', 'object_name'})
        resolve_connection(config)
    else:
        config = request.model_dump(include={'connection_id', 'redshift', 'host', 'port', 'database', 'user', 'password', 'tls', 'trust_server_certificate', 'mode', 'sql', 'schema_name', 'object_name'})
        password = config.pop('password')
        if password is None:
            if not previous:
                raise HTTPException(422, '请输入数据库密码，允许空密码')
            password = previous['password']
        else:
            password = cipher().encrypt(password.encode()).decode()
        config['password'] = password
    if isinstance(request, SourceRequest) and any((request.overrides, request.renames, request.formats, request.field_order)):
        config['field_settings'] = request.model_dump(include={'overrides', 'renames', 'formats', 'field_order', 'confirm_conversion'})
    elif previous and all(config.get(key) == previous.get(key) for key in ('connection_id', 'database', 'mode', 'sql', 'schema_name', 'object_name')) and previous.get('field_settings'):
        config['field_settings'] = previous['field_settings']
    if isinstance(request, SourceRequest) and request.annotation_fields is not None:
        config['annotation_fields'] = request.annotation_fields
    elif previous and previous.get('annotation_fields'):
        config['annotation_fields'] = previous['annotation_fields']
    return config


def safe_config(source: DynamicSource):
    return {**{key: value for key, value in source.config.items() if key != 'password'},
            'has_password': True, 'schedule': source.schedule,
            'duration_seconds': source.duration_seconds, 'last_error': source.last_error,
            'last_run_at': utc_iso(source.last_run_at), 'next_run_at': utc_iso(source.next_run_at)}


def execute(config: dict):
    from .api.datasets import query_slots
    with query_slots:
        return execute_query(config)


@contextmanager
def tls_options(config: dict):
    options = {'sslmode': ('require' if config['trust_server_certificate'] else 'verify-full') if config['tls'] else 'disable'}
    default_root = Path(os.getenv('APPDATA', str(Path.home()))) / 'postgresql/root.crt'
    if os.name != 'nt' or options['sslmode'] != 'verify-full' or os.getenv('PGSSLROOTCERT') or default_root.is_file():
        yield options
        return
    try:
        roots = ssl.create_default_context().get_ca_certs(binary_form=True)
        if not roots:
            raise HTTPException(422, 'Windows 中没有可用的受信任根证书')
        with TemporaryDirectory(prefix='mybi-tls-') as directory:
            bundle = Path(directory) / 'roots.pem'
            bundle.write_text(''.join(ssl.DER_cert_to_PEM_cert(root) for root in roots), encoding='ascii')
            yield {**options, 'sslrootcert': str(bundle)}
    except OSError:
        raise HTTPException(422, '无法加载 Windows 信任证书，请检查系统证书设置') from None


@contextmanager
def database_connection(config: dict):
    config = resolve_connection(config)
    started = perf_counter()
    try:
        password = cipher().decrypt(config['password'].encode()).decode()
    except (InvalidToken, ValueError, OSError):
        raise HTTPException(422, '无法解密数据库密码，请重新填写密码或恢复原密钥')
    redshift = config.get('redshift', False)
    driver = psycopg2 if redshift else psycopg
    query_sql = psycopg2.sql if redshift else sql
    try:
        with tls_options(config) as tls, closing(driver.connect(host=config['host'], port=config['port'], dbname=config['database'],
                                    user=config['user'], password=password, connect_timeout=15,
                                    **tls,
                                    application_name='MyBI', **({} if redshift else {'options': f'-c statement_timeout={settings.dynamic_timeout_seconds * 1000}'}))) as connection:
            if redshift:
                connection.readonly = True
            else:
                connection.read_only = True
            timer = Timer(settings.dynamic_timeout_seconds, connection.cancel)
            timer.daemon = True
            timer.start()
            try:
                if redshift:
                    with connection.cursor() as cursor:
                        cursor.execute(f'SET statement_timeout = {settings.dynamic_timeout_seconds * 1000}')
                yield connection, query_sql, redshift
            finally:
                timer.cancel()
                timer.join()
    except (psycopg.Error, psycopg2.Error) as error:
        message = (error.diag.message_primary if error.diag else None) or str(error)
        if password:
            message = message.replace(password, '***')
        raise HTTPException(422, {'code': 'source_query_failed', 'message': message[:1500], 'duration_seconds': perf_counter() - started}) from None


def execute_query(config: dict):
    started = perf_counter()
    try:
        with database_connection(config) as (connection, query_sql, redshift):
            if config['mode'] == 'sql':
                statement = query_sql.SQL('SELECT * FROM ({}) AS mybi_source').format(query_sql.SQL(config['sql'].strip().rstrip(';')))
            else:
                with connection.cursor() as cursor:
                    if redshift and config['mode'] == 'materialized_view':
                        cursor.execute("SELECT 'm' FROM svv_mv_info WHERE database_name = current_database() AND schema_name = %s AND name = %s", (config['schema_name'], config['object_name']))
                    elif redshift:
                        cursor.execute("SELECT CASE UPPER(table_type) WHEN 'VIEW' THEN 'v' WHEN 'BASE TABLE' THEN 'r' WHEN 'EXTERNAL TABLE' THEN 'f' END FROM svv_tables WHERE table_catalog = current_database() AND table_schema = %s AND table_name = %s", (config['schema_name'], config['object_name']))
                    else:
                        cursor.execute('SELECT c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=%s AND c.relname=%s', (config['schema_name'], config['object_name']))
                    found = cursor.fetchone()
                    expected = {'table': {'r', 'p', 'f'}, 'view': {'v'}, 'materialized_view': {'m'}}[config['mode']]
                    if not found or found[0] not in expected:
                        raise HTTPException(422, '指定的表或视图不存在，或对象类型不匹配')
                statement = query_sql.SQL('SELECT * FROM {}.{}').format(query_sql.Identifier(config['schema_name']), query_sql.Identifier(config['object_name']))
            with connection.cursor(name='mybi_result') as cursor:
                cursor.execute(statement)
                first = cursor.fetchmany(1000)
                if not first:
                    raise HTTPException(422, '查询结果为空，请检查 SQL 或数据源')
                names = [column.name for column in cursor.description]
                oids = [column.type_code for column in cursor.description]
                if any(not name for name in names) or len(set(names)) != len(names):
                    raise HTTPException(422, '查询结果字段名称必须非空且唯一，请为重复字段设置别名')
                rows, size = [], 0
                batch = first
                while batch:
                    if perf_counter() - started > settings.dynamic_timeout_seconds:
                        raise HTTPException(422, '查询超时，请缩小查询范围')
                    for row in batch:
                        size += sum(len(str(value).encode('utf-8')) if value is not None else 1 for value in row)
                        if size > settings.max_upload_bytes or len(rows) >= settings.dynamic_max_rows:
                            raise HTTPException(413, '查询结果超过数据集大小限制，请缩小查询范围')
                        rows.append(list(row))
                    batch = cursor.fetchmany(1000)
                fields = [Column(name, 'string' if text_field(name) else 'integer' if oid in {20, 21, 23} else 'number' if oid in {700, 701, 1700} else 'date' if oid in {1082, 1114, 1184} else 'string') for name, oid in zip(names, oids)]
                for row in rows:
                    for index, value in enumerate(row):
                        if value is not None and fields[index].type == 'string' and not isinstance(value, str):
                            row[index] = json.dumps(value, ensure_ascii=False, default=str) if isinstance(value, (dict, list)) else str(value)
                return TabularPreview(names, rows, fields), perf_counter() - started
    except HTTPException as error:
        if not isinstance(error.detail, str):
            raise
        raise HTTPException(error.status_code, {'code': 'source_validation_failed', 'message': error.detail, 'duration_seconds': perf_counter() - started})



def fingerprint(config: dict):
    config = resolve_connection(config)
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


def preview_fingerprint(config: dict):
    config = {key: value for key, value in resolve_connection(config).items() if key not in {'field_settings', 'annotation_fields'}}
    for key in (('schema_name', 'object_name') if config['mode'] == 'sql' else ('sql',)):
        config.pop(key, None)
    return fingerprint(config)


def preview_path(preview_id: str):
    try:
        identity = str(UUID(preview_id))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(422, '查询结果标识无效') from None
    return settings.snapshot_root.parent / 'source-previews' / identity


def discard_source_preview(preview_id: str):
    path = preview_path(preview_id)
    for suffix in ('.parquet', '.json'):
        try:
            path.with_suffix(suffix).unlink(missing_ok=True)
        except OSError:
            logging.getLogger('mybi.imports').warning('Unable to remove temporary query preview %s', preview_id)


def stage_source_preview(preview, config: dict, duration: float):
    from .api.datasets import table_for_preview
    preview_id = str(uuid4())
    path = preview_path(preview_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    for previous in path.parent.glob('*.parquet'):
        try:
            if previous.stat().st_mtime < time_module.time() - 86400:
                discard_source_preview(previous.stem)
        except FileNotFoundError:
            pass
    try:
        pq.write_table(table_for_preview(preview), path.with_suffix('.parquet'))
        atomic_json(path.with_suffix('.json'), {'fingerprint': preview_fingerprint(config), 'duration_seconds': duration,
                                               'fields': [{'name': field.name, 'type': field.type} for field in preview.fields]})
    except Exception:
        discard_source_preview(preview_id)
        raise
    return preview_id


def read_source_preview(preview_id: str, config: dict):
    path = preview_path(preview_id)
    try:
        if path.with_suffix('.json').stat().st_mtime < time_module.time() - 86400:
            discard_source_preview(preview_id)
            raise FileNotFoundError()
        metadata = json.loads(path.with_suffix('.json').read_text(encoding='utf-8'))
        if metadata['fingerprint'] != preview_fingerprint(config):
            raise HTTPException(409, '查询结果已失效，请返回数据源重新验证查询')
        table = pq.read_table(path.with_suffix('.parquet'))
    except FileNotFoundError:
        raise HTTPException(409, '查询结果已失效，请返回数据源重新验证查询') from None
    fields = [Column(field['name'], field['type']) for field in metadata['fields']]
    headers = [field.name for field in fields]
    rows = [list(row) for row in zip(*(table.column(name).to_pylist() for name in headers))]
    return TabularPreview(headers, rows, fields), metadata['duration_seconds']


def configured_preview(preview, config: dict):
    from .api.datasets import convert_preview
    fields = config.get('field_settings')
    if not fields:
        return preview
    return convert_preview(preview, fields['overrides'], fields['renames'], fields['field_order'], fields['confirm_conversion'], fields['formats'], config.get('annotation_fields'))


def cache_day(schedule: dict):
    return utc_now().astimezone(ZoneInfo(schedule.get('timezone', 'UTC'))).date().isoformat()


def save_cache(snapshot, config: dict, schedule: dict, duration: float, day: str):
    dataset_id = snapshot.dataset_id
    root = dataset_dir(dataset_id) / 'cache'
    atomic_copy(Path(snapshot.storage_uri), root / f'{day}.parquet')
    atomic_json(root / f'{day}.json', {'date': day, 'snapshot_id': snapshot.id,
                                     'fingerprint': fingerprint(config), 'row_count': snapshot.row_count,
                                     'duration_seconds': duration, 'created_at': utc_now().isoformat()})


def claim(dataset_id: str, due_only=False, scheduled_after=None):
    now = utc_now()
    token = str(uuid4())
    conditions = [DynamicSource.dataset_id == dataset_id, or_(DynamicSource.lease_until.is_(None), DynamicSource.lease_until <= now)]
    if due_only:
        conditions.append(DynamicSource.next_run_at <= now)
    if scheduled_after is not None:
        conditions.append(or_(DynamicSource.last_run_at.is_(None), DynamicSource.last_run_at < scheduled_after))
    with SessionLocal.begin() as session:
        result = session.execute(update(DynamicSource).where(*conditions).values(lease_token=token, lease_until=now + timedelta(seconds=settings.dynamic_timeout_seconds + 120)))
        if result.rowcount != 1:
            raise HTTPException(409, '数据集正在刷新或任务已被其他服务处理，请稍后再试')
    return token


def release(dataset_id: str, token: str, **values):
    with SessionLocal.begin() as session:
        session.execute(update(DynamicSource).where(DynamicSource.dataset_id == dataset_id, DynamicSource.lease_token == token).values(lease_token=None, lease_until=None, **values))


def refresh(dataset_id: str, force=False, due_only=False, scheduled_after=None):
    from .api.datasets import query_slots
    with query_slots:
        return refresh_locked(dataset_id, force, due_only, scheduled_after)


def refresh_locked(dataset_id: str, force=False, due_only=False, scheduled_after=None):
    from .api.datasets import dataset_payload, get_pair, publish
    token = claim(dataset_id, due_only, scheduled_after)
    with SessionLocal() as session:
        source = session.get(DynamicSource, dataset_id)
        config, schedule = source.config, source.schedule
    started = utc_now()
    duration = None
    try:
        execution_config = resolve_connection(config)
        dataset, _ = get_pair(dataset_id)
        root = dataset_dir(dataset_id) / 'cache'
        day = cache_day(schedule)
        index = root / f'{day}.json'
        cached = None
        if not force and index.is_file():
            try:
                cached = json.loads(index.read_text(encoding='utf-8'))
            except (ValueError, OSError):
                pass
        if not force and cached and cached.get('fingerprint') == fingerprint(execution_config) and (root / f'{day}.parquet').is_file() and cached.get('snapshot_id') == dataset.current_snapshot_id:
            release(dataset_id, token, next_run_at=next_run(schedule))
            return {**dataset_payload(*get_pair(dataset_id)), 'cache_hit': True, 'duration_seconds': cached['duration_seconds']}
        preview, duration = execute_query(execution_config)
        preview = configured_preview(preview, execution_config)
        day = cache_day(schedule)
        def on_publish(session, item, snapshot, files):
            locked = session.execute(update(DynamicSource).where(DynamicSource.dataset_id == dataset_id, DynamicSource.lease_token == token).values(duration_seconds=duration, last_run_at=started, last_error=None, next_run_at=next_run(schedule), lease_until=None, lease_token=None))
            if locked.rowcount != 1:
                raise HTTPException(409, '数据集正在刷新或任务已被其他服务处理，请稍后再试')
            files.enter_context(rollback_files([root / f'{day}.parquet', root / f'{day}.json']))
            save_cache(snapshot, execution_config, schedule, duration, day)
        publish(dataset.name, preview, 'dynamic', dataset_id=dataset_id, version=dataset.version, on_publish=on_publish, annotation_fields=config.get('annotation_fields'))
        return {**dataset_payload(*get_pair(dataset_id)), 'cache_hit': False, 'duration_seconds': duration}
    except Exception as error:
        detail = error.detail if isinstance(error, HTTPException) else '数据集刷新失败，请检查服务日志和存储权限'
        if isinstance(detail, dict):
            duration = detail.get('duration_seconds')
        release(dataset_id, token, duration_seconds=duration, last_run_at=started, last_error=json.dumps(detail, ensure_ascii=False) if isinstance(detail, dict) else str(detail), next_run_at=next_run(schedule))
        raise
