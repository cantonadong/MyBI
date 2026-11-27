"""Portals, roles, user list and report permissions (configuration only).

Login and enforcement are not implemented yet: they will come with the company account system. Until then these
records are stored and edited here; portal views on the main service list published reports.
"""
from getpass import getuser

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, or_, select

from ..db import SessionLocal
from ..models import Dashboard, Department, DirectoryUser, Portal, PublishedDashboard, ReportPermission, Role, UserProfile
from ..storage import resource_identity

router = APIRouter(prefix='/api')


def _name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError('名称不能为空')
    return value


# ---------- current account (synced from 个人资料) ----------

def current_account(session):
    """The local account always appears in the user list; username/email follow 个人资料."""
    profile = session.get(UserProfile, 1)
    username = ((profile.display_name if profile else '') or '').strip() or getuser()
    email = ((profile.email if profile else '') or '').strip()
    user = session.scalar(select(DirectoryUser).where(DirectoryUser.is_current.is_(True)))
    if user is None:
        user = session.scalar(select(DirectoryUser).where(func.lower(DirectoryUser.username) == username.lower()))
        if user is None:
            user = DirectoryUser(username=username, email=email, department_ids=[])
            session.add(user)
        user.is_current = True
    clash = session.scalar(select(DirectoryUser).where(func.lower(DirectoryUser.username) == username.lower(), DirectoryUser.id != user.id)) if user.id else None
    if not clash and (user.username, user.email) != (username, email):
        user.username, user.email = username, email
    session.flush()
    return user


# ---------- users (for role members and permissions, suggested by username or email) ----------

class UserBody(BaseModel):
    username: str = Field(default='', max_length=255)
    email: str = Field(default='', max_length=255)

    @field_validator('username', 'email')
    @classmethod
    def strip(cls, value):
        return value.strip()


def user_payload(user: DirectoryUser):
    return {'id': user.id, 'username': user.username, 'email': user.email, 'current': bool(user.is_current)}


def users_by_id(session, ids):
    found = {user.id: user for user in session.scalars(select(DirectoryUser).where(DirectoryUser.id.in_(ids)))} if ids else {}
    return [user_payload(found[identity]) for identity in ids if identity in found]


@router.get('/directory-users')
def search_users(search: str = Query(default='', max_length=255)):
    with SessionLocal.begin() as session:
        current_account(session)
        statement = select(DirectoryUser).order_by(DirectoryUser.username).limit(20)
        if search.strip():
            pattern = f'%{search.strip().lower()}%'
            statement = statement.where(or_(func.lower(DirectoryUser.username).like(pattern), func.lower(DirectoryUser.email).like(pattern)))
        return [user_payload(user) for user in session.scalars(statement)]


@router.post('/directory-users')
def add_user(body: UserBody):
    username = body.username or body.email.split('@')[0]
    if not username:
        raise HTTPException(422, '请输入用户名或邮箱')
    if body.email and ('@' not in body.email or ' ' in body.email):
        raise HTTPException(422, '邮箱格式不正确')
    with SessionLocal.begin() as session:
        existing = session.scalar(select(DirectoryUser).where(func.lower(DirectoryUser.username) == username.lower()))
        if existing:
            if body.email and not existing.email:
                existing.email = body.email
            return user_payload(existing)
        user = DirectoryUser(username=username, email=body.email, department_ids=[])
        session.add(user)
        session.flush()
        return user_payload(user)


# ---------- departments (a user can be in several; roles can include whole departments) ----------

class DepartmentBody(BaseModel):
    name: str = Field(min_length=1, max_length=255)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        return _name(value)


def department_payload(department: Department):
    return {'id': department.id, 'name': department.name}


def departments_by_id(session, ids):
    found = {item.id: item for item in session.scalars(select(Department).where(Department.id.in_(ids)))} if ids else {}
    return [department_payload(found[identity]) for identity in ids if identity in found]


@router.get('/departments')
def search_departments(search: str = Query(default='', max_length=255)):
    with SessionLocal() as session:
        statement = select(Department).order_by(Department.name).limit(50)
        if search.strip():
            statement = statement.where(func.lower(Department.name).like(f'%{search.strip().lower()}%'))
        return [department_payload(item) for item in session.scalars(statement)]


@router.post('/departments')
def add_department(body: DepartmentBody):
    with SessionLocal.begin() as session:
        existing = session.scalar(select(Department).where(func.lower(Department.name) == body.name.lower()))
        if existing:
            return department_payload(existing)
        department = Department(name=body.name)
        session.add(department)
        session.flush()
        return department_payload(department)


# ---------- user management (local list for now; replaced by the company account system later) ----------

class ManagedUserBody(UserBody):
    role_ids: list[str] = Field(default_factory=list, max_length=1000)
    department_ids: list[str] = Field(default_factory=list, max_length=1000)


def managed_user_payload(user: DirectoryUser, session, roles):
    return {**user_payload(user), 'local_id': resource_identity('user', user.id, session).number,
            'departments': departments_by_id(session, user.department_ids or []),
            'roles': [{'id': role.id, 'name': role.name} for role in roles if user.id in (role.member_ids or [])]}


def _apply_user(session, user: DirectoryUser, body: ManagedUserBody):
    if not user.is_current:
        username = body.username or body.email.split('@')[0]
        if not username:
            raise HTTPException(422, '请输入用户名或邮箱')
        if body.email and ('@' not in body.email or ' ' in body.email):
            raise HTTPException(422, '邮箱格式不正确')
        clash = session.scalar(select(DirectoryUser).where(func.lower(DirectoryUser.username) == username.lower()))
        if clash and clash is not user:
            raise HTTPException(409, '用户名已存在')
        user.username, user.email = username, body.email
    user.department_ids = list(dict.fromkeys(body.department_ids))
    session.add(user)
    session.flush()
    # Direct role membership is stored on the role; a user can belong to several roles.
    wanted = set(body.role_ids)
    roles = list(session.scalars(select(Role).order_by(Role.name)))
    for role in roles:
        members = list(role.member_ids or [])
        if role.id in wanted and user.id not in members:
            role.member_ids = [*members, user.id]
        elif role.id not in wanted and user.id in members:
            role.member_ids = [value for value in members if value != user.id]
    return managed_user_payload(user, session, roles)


@router.get('/users')
def list_users():
    with SessionLocal.begin() as session:
        current_account(session)
        roles = list(session.scalars(select(Role).order_by(Role.name)))
        users = sorted(session.scalars(select(DirectoryUser)), key=lambda user: (not user.is_current, user.username.lower()))
        return [managed_user_payload(user, session, roles) for user in users]


@router.post('/users', status_code=201)
def create_user(body: ManagedUserBody):
    with SessionLocal.begin() as session:
        return _apply_user(session, DirectoryUser(), body)


@router.put('/users/{user_id}')
def save_user(user_id: str, body: ManagedUserBody):
    with SessionLocal.begin() as session:
        user = session.get(DirectoryUser, user_id)
        if not user:
            raise HTTPException(404, '用户不存在')
        return _apply_user(session, user, body)


@router.delete('/users/{user_id}', status_code=204)
def delete_user(user_id: str):
    with SessionLocal.begin() as session:
        user = session.get(DirectoryUser, user_id)
        if not user:
            raise HTTPException(404, '用户不存在')
        if user.is_current:
            raise HTTPException(409, '当前账号不能删除')
        session.delete(user)
        for role in session.scalars(select(Role)):
            if user_id in (role.member_ids or []):
                role.member_ids = [value for value in role.member_ids if value != user_id]
        for permission in session.scalars(select(ReportPermission)):
            if user_id in (permission.user_ids or []):
                permission.user_ids = [value for value in permission.user_ids if value != user_id]


# ---------- roles ----------

class RoleBody(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    member_ids: list[str] = Field(default_factory=list, max_length=5000)
    department_ids: list[str] = Field(default_factory=list, max_length=1000)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        return _name(value)


def role_payload(role: Role, session):
    departments = departments_by_id(session, role.department_ids or [])
    direct = set(role.member_ids or [])
    in_departments = {user.id for user in session.scalars(select(DirectoryUser)) if set(user.department_ids or []) & set(role.department_ids or [])}
    return {'id': role.id, 'local_id': resource_identity('role', role.id, session).number, 'name': role.name,
            'members': users_by_id(session, role.member_ids or []), 'departments': departments,
            'member_count': len(direct | in_departments)}


def _unique_role(session, name, current=None):
    clash = session.scalar(select(Role).where(func.lower(Role.name) == name.lower()))
    if clash and clash.id != current:
        raise HTTPException(409, '角色名称已存在')


@router.get('/roles')
def list_roles():
    with SessionLocal.begin() as session:
        return [role_payload(role, session) for role in session.scalars(select(Role).order_by(Role.name))]


@router.post('/roles', status_code=201)
def create_role(body: RoleBody):
    with SessionLocal.begin() as session:
        _unique_role(session, body.name)
        role = Role(name=body.name, member_ids=list(dict.fromkeys(body.member_ids)), department_ids=list(dict.fromkeys(body.department_ids)))
        session.add(role)
        session.flush()
        return role_payload(role, session)


@router.put('/roles/{role_id}')
def save_role(role_id: str, body: RoleBody):
    with SessionLocal.begin() as session:
        role = session.get(Role, role_id)
        if not role:
            raise HTTPException(404, '角色不存在')
        _unique_role(session, body.name, role_id)
        role.name, role.member_ids, role.department_ids = body.name, list(dict.fromkeys(body.member_ids)), list(dict.fromkeys(body.department_ids))
        return role_payload(role, session)


@router.delete('/roles/{role_id}', status_code=204)
def delete_role(role_id: str):
    with SessionLocal.begin() as session:
        role = session.get(Role, role_id)
        if not role:
            raise HTTPException(404, '角色不存在')
        session.delete(role)
        for permission in session.scalars(select(ReportPermission)):
            if role_id in (permission.role_ids or []):
                permission.role_ids = [value for value in permission.role_ids if value != role_id]


# ---------- report permissions ----------

class PermissionBody(BaseModel):
    role_ids: list[str] = Field(default_factory=list, max_length=1000)
    user_ids: list[str] = Field(default_factory=list, max_length=5000)


def permission_payload(report: Dashboard, permission: ReportPermission | None, session, roles):
    role_ids = [identity for identity in (permission.role_ids if permission else []) if identity in roles]
    return {'report_id': report.id, 'local_id': resource_identity('report', report.id, session).number, 'report_name': report.name,
            'published': session.get(PublishedDashboard, report.id) is not None,
            'roles': [{'id': identity, 'name': roles[identity]} for identity in role_ids],
            'users': users_by_id(session, permission.user_ids if permission else [])}


@router.get('/report-permissions')
def list_permissions():
    with SessionLocal.begin() as session:
        roles = {role.id: role.name for role in session.scalars(select(Role))}
        permissions = {item.report_id: item for item in session.scalars(select(ReportPermission))}
        return [permission_payload(report, permissions.get(report.id), session, roles) for report in session.scalars(select(Dashboard).order_by(Dashboard.name))]


@router.put('/report-permissions/{report_id}')
def save_permission(report_id: str, body: PermissionBody):
    with SessionLocal.begin() as session:
        report = session.get(Dashboard, report_id)
        if not report:
            raise HTTPException(404, '报表不存在')
        permission = session.get(ReportPermission, report_id)
        if not permission:
            permission = ReportPermission(report_id=report_id)
            session.add(permission)
        permission.role_ids, permission.user_ids = list(dict.fromkeys(body.role_ids)), list(dict.fromkeys(body.user_ids))
        session.flush()
        roles = {role.id: role.name for role in session.scalars(select(Role))}
        return permission_payload(report, permission, session, roles)


# ---------- portals ----------

class PortalBody(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    report_ids: list[str] = Field(default_factory=list, max_length=1000)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        return _name(value)


def portal_reports(session, report_ids, published_only=False):
    reports = {report.id: report for report in session.scalars(select(Dashboard).where(Dashboard.id.in_(report_ids)))} if report_ids else {}
    published = {item.id: item for item in session.scalars(select(PublishedDashboard).where(PublishedDashboard.id.in_(report_ids)))} if report_ids else {}
    result = []
    for identity in report_ids:
        if identity not in reports or (published_only and identity not in published):
            continue
        result.append({'id': identity, 'name': published[identity].name if identity in published else reports[identity].name, 'published': identity in published})
    return result


def portal_payload(portal: Portal, session):
    return {'id': portal.id, 'local_id': resource_identity('portal', portal.id, session).number, 'name': portal.name, 'reports': portal_reports(session, portal.report_ids or [])}


@router.get('/portals')
def list_portals():
    with SessionLocal.begin() as session:
        return [portal_payload(portal, session) for portal in session.scalars(select(Portal).order_by(Portal.name))]


@router.post('/portals', status_code=201)
def create_portal(body: PortalBody):
    with SessionLocal.begin() as session:
        portal = Portal(name=body.name, report_ids=list(dict.fromkeys(body.report_ids)))
        session.add(portal)
        session.flush()
        return portal_payload(portal, session)


@router.put('/portals/{portal_id}')
def save_portal(portal_id: str, body: PortalBody):
    with SessionLocal.begin() as session:
        portal = session.get(Portal, portal_id)
        if not portal:
            raise HTTPException(404, 'Portal 不存在')
        portal.name, portal.report_ids = body.name, list(dict.fromkeys(body.report_ids))
        return portal_payload(portal, session)


@router.delete('/portals/{portal_id}', status_code=204)
def delete_portal(portal_id: str):
    with SessionLocal.begin() as session:
        session.execute(delete(Portal).where(Portal.id == portal_id))


@router.get('/portal-view/{portal_id}')
def portal_view(portal_id: str):
    """Return the portal name and published reports in the configured order."""
    with SessionLocal() as session:
        portal = session.get(Portal, portal_id)
        if not portal:
            raise HTTPException(404, 'Portal 不存在')
        return {'id': portal.id, 'name': portal.name, 'reports': [{'id': item['id'], 'name': item['name']} for item in portal_reports(session, portal.report_ids or [], published_only=True)]}
