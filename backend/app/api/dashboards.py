from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update, func, delete
from sqlalchemy.orm import object_session
from datetime import datetime, timezone
from getpass import getuser
from contextlib import ExitStack
from ..db import SessionLocal
from ..models import Dashboard, PublishedDashboard, ChartComment, UserProfile, DynamicSource, new_id
from .datasets import get_pair, dataset_payload
from ..storage import write_report, rollback_files, resource_metadata, report_path
from ..folder_sync import synchronize_folders
from ..settings import settings

router = APIRouter(prefix='/api/dashboards')

class ReportTab(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=80)

class SaveDashboard(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    document: dict
    version: int = 1

    @field_validator('document')
    @classmethod
    def validate_schedule(cls, document):
        if 'tabs' in document:
            if not isinstance(document['tabs'], list) or not document['tabs']:
                raise ValueError('报表至少需要一个标签页')
            tabs = [ReportTab.model_validate(tab) for tab in document['tabs']]
            ids = {tab.id for tab in tabs}
            if len(ids) != len(tabs) or any((chart.get('tabId') or tabs[0].id) not in ids for chart in document.get('charts', [])):
                raise ValueError('报表标签页引用无效')
        if 'refreshSchedule' in document:
            from ..dynamic import Schedule
            document['refreshSchedule'] = Schedule.model_validate(document['refreshSchedule']).model_dump()
        return document


class PublishDashboard(BaseModel):
    version: int
    theme: dict = Field(default_factory=dict)


class AddComment(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


def publication_dataset_ids(document: dict) -> list[str]:
    sources = {source['id']: source for source in document.get('datasets', []) if source.get('id')}
    charts = document.get('charts', [])
    ids = dict.fromkeys(chart['datasetId'] for chart in charts if chart.get('datasetId') and chart.get('config', {}).get('type') != 'title')
    annotation_types = {'bar', 'line', 'area', 'mixed', 'candlestick', 'waterfall', 'boxplot', 'heatmap'}
    baseline_types = {'bar', 'line', 'area', 'mixed', 'scatter', 'waterfall', 'boxplot', 'candlestick'}
    include_annotations = False
    for chart in charts:
        config = chart.get('config', {})
        if not include_annotations and config.get('showAnnotations') and config.get('type') in annotation_types and not config.get('horizontal'):
            schema = sources.get(chart.get('datasetId'), {}).get('schema') or []
            dimension = config.get('dimension')
            include_annotations = bool(dimension) and any(
                field.get('name') == dimension and field.get('type') in {'date', 'string'} for field in schema
            )
        if config.get('showBaselines') and config.get('type') in baseline_types:
            for field in config.get('baselineFields') or []:
                source_id = field.get('datasetId')
                if sources.get(source_id, {}).get('baseline_values') is not None:
                    ids[source_id] = None
    if include_annotations:
        ids.update(dict.fromkeys(source_id for source_id, source in sources.items() if source.get('annotation_fields')))
    return list(ids)


def publication_datasets(document: dict) -> list[dict]:
    return [dataset_payload(*get_pair(source_id)) for source_id in publication_dataset_ids(document)]


@router.post('/publication-datasets')
def list_publication_datasets(body: SaveDashboard):
    return publication_datasets(body.document)


@router.post('/{dashboard_id}/publish')
def publish_dashboard(dashboard_id: str, body: PublishDashboard):
    with ExitStack() as files, SessionLocal.begin() as session:
        item = session.get(Dashboard, dashboard_id)
        if not item:
            raise HTTPException(404, 'Dashboard not found')
        if item.version != body.version:
            raise HTTPException(409, '报表已被其他操作修改，请重新打开后再发布')
        locked = session.execute(update(Dashboard).where(Dashboard.id == dashboard_id, Dashboard.version == body.version).values(version=body.version))
        if locked.rowcount != 1:
            raise HTTPException(409, '报表已被其他操作修改，请重新打开后再发布')
        files.enter_context(rollback_files([report_path(dashboard_id, session), settings.report_root / f'{dashboard_id}.json']))
        document = {key: value for key, value in item.document.items() if key not in {'_mybi', 'datasetFolders'}}
        document['datasets'] = publication_datasets(document)
        published = session.get(PublishedDashboard, dashboard_id)
        if not published:
            published = PublishedDashboard(id=dashboard_id)
            session.add(published)
        published.name = item.name
        published.document = document
        published.theme = body.theme
        write_report(dashboard_id, session)
    return {'id': dashboard_id}


@router.get('/{dashboard_id}/published')
def get_published(dashboard_id: str):
    synchronize_folders()
    with SessionLocal() as session:
        item = session.get(PublishedDashboard, dashboard_id)
        if not item:
            raise HTTPException(404, 'Report has not been published')
        ids = set(publication_dataset_ids(item.document))
        document = {**item.document, 'datasets': [dataset_payload(*get_pair(source['id'])) if session.get(DynamicSource, source.get('id')) else source for source in item.document.get('datasets', []) if source.get('id') in ids]}
        document.pop('datasetFolders', None)
        return {'id': item.id, 'name': item.name, 'document': document, 'theme': item.theme}


@router.get('/{dashboard_id}/comment-counts')
def comment_counts(dashboard_id: str):
    with SessionLocal() as session:
        return dict(session.execute(select(ChartComment.chart_id, func.count()).where(ChartComment.dashboard_id == dashboard_id).group_by(ChartComment.chart_id)).all())


@router.get('/{dashboard_id}/charts/{chart_id}/comments')
def list_comments(dashboard_id: str, chart_id: str):
    with SessionLocal() as session:
        items = session.scalars(select(ChartComment).where(ChartComment.dashboard_id == dashboard_id, ChartComment.chart_id == chart_id).order_by(ChartComment.created_at.desc(), ChartComment.id.desc()))
        profile = session.get(UserProfile, 1)
        return [{'id': item.id, 'author': profile.display_name if item.author_id == 1 and profile else item.author, 'avatar': profile.avatar if item.author_id == 1 and profile else item.avatar, 'can_edit': item.author_id == 1, 'can_delete': item.author_id in (0, 1), 'content': item.content, 'created_at': item.created_at.replace(tzinfo=timezone.utc).isoformat()} for item in items]


@router.put('/{dashboard_id}/charts/{chart_id}/comments/{comment_id}')
def edit_comment(dashboard_id: str, chart_id: str, comment_id: str, body: AddComment):
    content = body.content.strip()
    if not content:
        raise HTTPException(422, 'Comment cannot be empty')
    with SessionLocal.begin() as session:
        item = session.get(ChartComment, comment_id)
        if not item or item.dashboard_id != dashboard_id or item.chart_id != chart_id:
            raise HTTPException(404, 'Comment not found')
        if item.author_id != 1:
            raise HTTPException(403, 'You can only edit your own comments')
        item.content = content
    return {'saved': True}


@router.post('/{dashboard_id}/charts/{chart_id}/comments', status_code=201)
def add_comment(dashboard_id: str, chart_id: str, body: AddComment):
    content = body.content.strip()
    if not content:
        raise HTTPException(422, 'Comment cannot be empty')
    with SessionLocal.begin() as session:
        report = session.get(Dashboard, dashboard_id)
        published = session.get(PublishedDashboard, dashboard_id)
        charts = (report.document.get('charts', []) if report else []) + (published.document.get('charts', []) if published else [])
        if not any(chart['id'] == chart_id for chart in charts):
            raise HTTPException(404, 'Chart not found')
        profile = session.get(UserProfile, 1)
        session.add(ChartComment(dashboard_id=dashboard_id, chart_id=chart_id, author=profile.display_name if profile else getuser(), avatar=profile.avatar if profile else '', content=content))
    return {'saved': True}


@router.delete('/{dashboard_id}/charts/{chart_id}/comments/{comment_id}', status_code=204)
def delete_comment(dashboard_id: str, chart_id: str, comment_id: str):
    with SessionLocal.begin() as session:
        item = session.get(ChartComment, comment_id)
        if not item or item.dashboard_id != dashboard_id or item.chart_id != chart_id:
            raise HTTPException(404, 'Comment not found')
        # The local user may delete their own comments and visitor comments posted on published pages (author_id 0).
        if item.author_id not in (0, 1):
            raise HTTPException(403, 'You can only delete your own comments')
        session.delete(item)

def payload(item):
    metadata = item.document.get('_mybi', {})
    identity = resource_metadata('report', item.id, object_session(item))
    return {'id': item.id, **identity, 'name': item.name, 'document': {key: value for key, value in item.document.items() if key != '_mybi'}, 'version': item.version, 'owner': metadata.get('owner') or identity['owner'], 'updated_at': metadata.get('updated_at') or identity['updated_at'], 'pages': len(item.document.get('tabs') or [None]), 'published': object_session(item).get(PublishedDashboard, item.id) is not None, 'storage_path': f"reports/{identity['fingerprint']}.json"}


def saved_document(document, owner=None):
    return {**document, '_mybi': {'owner': owner or getuser(), 'updated_at': datetime.now(timezone.utc).isoformat()}}

@router.get('')
def list_dashboards():
    synchronize_folders()
    with SessionLocal() as session:
        return sorted([payload(item) for item in session.scalars(select(Dashboard))], key=lambda item: item['updated_at'] or '', reverse=True)

@router.post('', status_code=201)
def create_dashboard(body: SaveDashboard):
    report_id = new_id()
    with ExitStack() as files, SessionLocal.begin() as session:
        item = Dashboard(id=report_id, name=body.name, document=saved_document(body.document))
        session.add(item)
        session.flush()
        files.enter_context(rollback_files([report_path(report_id, session), settings.report_root / f'{report_id}.json']))
        result = payload(item)
        write_report(item.id, session)
    return result

@router.get('/{dashboard_id}')
def get_dashboard(dashboard_id: str, include_datasets: bool = False):
    synchronize_folders()
    with SessionLocal() as session:
        item = session.get(Dashboard, dashboard_id)
        if not item:
            raise HTTPException(404, 'Dashboard not found')
        result = payload(item)
        if include_datasets:
            ids = dict.fromkeys([chart['datasetId'] for chart in item.document.get('charts', []) if chart.get('datasetId')] + [source['id'] for source in item.document.get('datasets', []) if source.get('id')])
            result['datasets'] = []
            for source_id in ids:
                try:
                    result['datasets'].append(dataset_payload(*get_pair(source_id)))
                except HTTPException as error:
                    if error.status_code not in (404, 410):
                        raise
        return result

@router.put('/{dashboard_id}')
def save_dashboard(dashboard_id: str, body: SaveDashboard):
    with ExitStack() as files, SessionLocal.begin() as session:
        current = session.get(Dashboard, dashboard_id)
        if not current:
            raise HTTPException(404, 'Dashboard not found')
        document = saved_document(body.document, current.document.get('_mybi', {}).get('owner'))
        result = session.execute(update(Dashboard).where(Dashboard.id == dashboard_id, Dashboard.version == body.version).values(name=body.name, document=document, version=body.version + 1))
        if result.rowcount != 1:
            raise HTTPException(409, '报表已被其他操作修改，请重新打开后再保存')
        files.enter_context(rollback_files([report_path(dashboard_id, session), settings.report_root / f'{dashboard_id}.json']))
        result = payload(session.get(Dashboard, dashboard_id))
        write_report(dashboard_id, session)
    return result

@router.delete('/{dashboard_id}', status_code=204)
def delete_dashboard(dashboard_id: str):
    with ExitStack() as files, SessionLocal.begin() as session:
        item = session.get(Dashboard, dashboard_id)
        if not item:
            raise HTTPException(404, 'Dashboard not found')
        session.delete(item)
        published = session.get(PublishedDashboard, dashboard_id)
        if published:
            session.delete(published)
        session.execute(delete(ChartComment).where(ChartComment.dashboard_id == dashboard_id))
        session.flush()
        files.enter_context(rollback_files([report_path(dashboard_id, session), settings.report_root / f'{dashboard_id}.json']))
        write_report(dashboard_id, session)
