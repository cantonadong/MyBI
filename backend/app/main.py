from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .api.datasets import router as datasets_router
from .db import Base, engine
from .api.dashboards import router as dashboards_router
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
from .storage import materialize_existing
from .connections import router as connections_router, migrate_connections


@asynccontextmanager
async def lifespan(app):
    migrate_connections()
    materialize_existing()
    stop = Event()
    worker = None
    if os.getenv('MYBI_SCHEDULER', 'true').lower() == 'true':
        from .scheduler import run
        worker = Thread(target=run, args=(stop,), daemon=True)
        worker.start()
    try:
        yield
    finally:
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
app.include_router(datasets_router)
app.include_router(dashboards_router)
app.include_router(profile_router)
app.include_router(sources_router)
app.include_router(connections_router)


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
if WEB_DIST.is_dir():
    @app.get('/reports', include_in_schema=False)
    @app.get('/reports/new', include_in_schema=False)
    @app.get('/datasets', include_in_schema=False)
    @app.get('/settings', include_in_schema=False)
    def module_page():
        return FileResponse(WEB_DIST / 'index.html')

    @app.get('/reports/{report_id}', include_in_schema=False)
    @app.get('/view/{report_id}', include_in_schema=False)
    def report_page(report_id: str):
        return FileResponse(WEB_DIST / 'index.html')

    app.mount('/', StaticFiles(directory=WEB_DIST, html=True), name='web')

