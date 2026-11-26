from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .api.datasets import router as datasets_router
from .db import Base, engine
from .api.dashboards import router as dashboards_router
from .api.report_bundle import router as report_bundle_router
from .api.profile import router as profile_router
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from pathlib import Path
import os
import duckdb
from sqlalchemy import inspect, text
from python_calamine import CalamineError
from contextlib import asynccontextmanager
from threading import Event, Thread
import base64
import secrets
from .api.sources import router as sources_router
from .api.scheduled_queries import router as scheduled_queries_router
from .api.access import router as access_router
from .storage import materialize_existing
from .connections import router as connections_router, migrate_connections
from .shared_data import synchronize_connections
from . import public_access


@asynccontextmanager
async def lifespan(app):
    migrate_connections()
    synchronize_connections()
    materialize_existing()
    public_access.startup()
    stop = Event()
    worker = None
    if os.getenv('MYBI_SCHEDULER', 'true').lower() == 'true':
        from .scheduler import run
        worker = Thread(target=run, args=(stop,), daemon=True)
        worker.start()
    try:
        yield
    finally:
        public_access.shutdown()
        stop.set()
        if worker:
            worker.join(timeout=2)

app = FastAPI(title="Data Workbench API", lifespan=lifespan)


@app.middleware('http')
async def server_auth(request: Request, call_next):
    username, password = os.getenv('MYBI_ADMIN_USER'), os.getenv('MYBI_ADMIN_PASSWORD')
    if username or password:
        if not username or not password:
            return JSONResponse(status_code=503, content={'detail': 'Server credentials are not configured'})
        try:
            scheme, token = request.headers.get('authorization', '').split(' ', 1)
            supplied = base64.b64decode(token, validate=True).decode('utf-8') if scheme.lower() == 'basic' else ''
            user, secret = supplied.split(':', 1)
            valid = secrets.compare_digest(user.encode(), username.encode()) & secrets.compare_digest(secret.encode(), password.encode())
        except (ValueError, UnicodeError):
            valid = False
        if not valid:
            return JSONResponse(status_code=401, content={'detail': 'Authentication required'}, headers={'WWW-Authenticate': 'Basic realm="MyBI", charset="UTF-8"'})
    return await call_next(request)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
Base.metadata.create_all(engine)
with engine.begin() as connection:
    if 'author_id' not in {column['name'] for column in inspect(connection).get_columns('chart_comments')}:
        connection.execute(text('ALTER TABLE chart_comments ADD COLUMN author_id INTEGER NOT NULL DEFAULT 1'))
    identity_columns = {column['name'] for column in inspect(connection).get_columns('resource_identities')}
    if 'owner' not in identity_columns:
        connection.execute(text('ALTER TABLE resource_identities ADD COLUMN owner VARCHAR(255)'))
    if 'updated_at' not in identity_columns:
        connection.execute(text('ALTER TABLE resource_identities ADD COLUMN updated_at TIMESTAMP'))
    if 'number' not in identity_columns:
        # Per-kind IDs from now on; already assigned IDs keep their value.
        connection.execute(text('ALTER TABLE resource_identities ADD COLUMN number INTEGER'))
        connection.execute(text('UPDATE resource_identities SET number = local_id WHERE number IS NULL'))
        # One-off: drop leftover numbers of already-deleted portals/users/roles/tasks so those kinds start from 1.
        for kind, table in (('portal', 'portals'), ('user', 'directory_users'), ('role', 'roles'), ('scheduled', 'scheduled_queries')):
            connection.execute(text(f'DELETE FROM resource_identities WHERE kind = :kind AND resource_id NOT IN (SELECT id FROM {table})'), {'kind': kind})
    user_columns = {column['name'] for column in inspect(connection).get_columns('directory_users')}
    if 'department_ids' not in user_columns:
        connection.execute(text("ALTER TABLE directory_users ADD COLUMN department_ids JSON NOT NULL DEFAULT '[]'"))
    if 'is_current' not in user_columns:
        connection.execute(text('ALTER TABLE directory_users ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT 0'))
    if 'department_ids' not in {column['name'] for column in inspect(connection).get_columns('roles')}:
        connection.execute(text("ALTER TABLE roles ADD COLUMN department_ids JSON NOT NULL DEFAULT '[]'"))
app.include_router(datasets_router)
app.include_router(report_bundle_router)
app.include_router(dashboards_router)
app.include_router(profile_router)
app.include_router(sources_router)
app.include_router(scheduled_queries_router)
app.include_router(access_router)
app.include_router(connections_router)
app.include_router(public_access.router)


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    errors = [{'loc': entry['loc'], 'msg': entry['msg'], 'type': entry['type']} for entry in error.errors()]
    return JSONResponse(status_code=422, content={'detail': errors})


@app.exception_handler(ValueError)
async def invalid_input(request: Request, error: ValueError):
    return JSONResponse(status_code=422, content={'detail': str(error)})


@app.exception_handler(duckdb.Error)
async def invalid_query(request: Request, error: duckdb.Error):
    return JSONResponse(status_code=422, content={'detail': '字段类型或图表绑定不兼容，请检查数值指标、维度和筛选条件。'})


@app.exception_handler(CalamineError)
async def invalid_workbook(request: Request, error: CalamineError):
    return JSONResponse(status_code=422, content={'detail': '无法读取工作簿，请检查格式、密码保护及文件是否损坏。'})


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "pid": os.getpid(), "project_root": str(Path(__file__).resolve().parents[2])}


WEB_DIST = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'


@app.middleware('http')
async def revalidate_pages(request, call_next):
    # HTML pages (editor and published /view pages) name the current hashed bundle; always revalidate them so a
    # rebuilt MyBI is picked up instead of a cached page that still loads the previous bundle.
    response = await call_next(request)
    if response.headers.get('content-type', '').startswith('text/html') and 'cache-control' not in response.headers:
        response.headers['Cache-Control'] = 'no-cache'
    return response


if WEB_DIST.is_dir():
    @app.get('/reports', include_in_schema=False)
    @app.get('/reports/new', include_in_schema=False)
    @app.get('/datasets', include_in_schema=False)
    @app.get('/scheduled-queries', include_in_schema=False)
    @app.get('/portals', include_in_schema=False)
    @app.get('/roles', include_in_schema=False)
    @app.get('/permissions', include_in_schema=False)
    @app.get('/users', include_in_schema=False)
    @app.get('/settings', include_in_schema=False)
    def module_page():
        return FileResponse(WEB_DIST / 'index.html')

    @app.get('/reports/{report_id}', include_in_schema=False)
    @app.get('/view/{report_id}', include_in_schema=False)
    def report_page(report_id: str):
        return FileResponse(WEB_DIST / 'index.html')

    app.mount('/', StaticFiles(directory=WEB_DIST, html=True), name='web')

