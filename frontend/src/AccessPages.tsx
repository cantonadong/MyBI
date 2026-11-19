// Portal, role and permission management (configuration only; login/enforcement comes with the company account system).
import { useEffect, useState } from 'react';
import { api, json } from './dashboard';
import { t, useLanguage } from './i18n';
import { Icon } from './Icon';
import { Pagination } from './Pagination';
import { confirmAction } from './confirmAction';
import { copyText, publicLink } from './PublicAccessSettings';
import './search-select.css';

type User = { id: string; username: string; email: string; current?: boolean };
type Department = { id: string; name: string };
type ReportRef = { id: string; name: string; published?: boolean };
type PortalItem = { id: string; local_id: number; name: string; reports: ReportRef[] };
type RoleItem = { id: string; local_id: number; name: string; members: User[]; departments: Department[]; member_count: number };
type PermissionItem = { report_id: string; local_id: number; report_name: string; published: boolean; roles: { id: string; name: string }[]; users: User[] };

function useList<T>(path: string, onError: (message: string) => void) {
  const [items, setItems] = useState<T[]>([]);
  const reload = () => api(path).then(setItems).catch(error => onError(error.message));
  useEffect(() => { void reload(); }, [path]);
  return [items, setItems, reload] as const;
}
const pageOf = (requested: number, total: number) => Math.min(requested, Math.max(0, Math.ceil(total / 10) - 1));

// Chip picker with suggestions: Enter adds the exact/only match, or creates a new entry from the typed text.
function EntityPicker<T extends { id: string }>({ value, onChange, label, searchPath, create, name, detail, placeholder, createLabel, emptyLabel }: { value: T[]; onChange: (items: T[]) => void; label: string; searchPath: string; create: (text: string) => Promise<T>; name: (item: T) => string; detail?: (item: T) => string; placeholder: string; createLabel: (text: string) => string; emptyLabel: string }) {
  const [text, setText] = useState(''), [options, setOptions] = useState<T[]>([]), [open, setOpen] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => api(searchPath + '?search=' + encodeURIComponent(text.trim())).then(setOptions).catch(error => setError(error.message)), 200);
    return () => window.clearTimeout(timer);
  }, [text, open, searchPath]);
  const choices = options.filter(option => !value.some(item => item.id === option.id));
  const query = text.trim().toLowerCase();
  const exact = choices.find(option => name(option).toLowerCase() === query || (detail?.(option) || '').toLowerCase() === query);
  const add = (item: T) => { if (!value.some(current => current.id === item.id)) onChange([...value, item]); setText(''); setError(''); };
  const createItem = async () => { if (!query) return; try { add(await create(text.trim())); } catch (error) { setError((error as Error).message); } };
  return <div className="user-picker">
    {value.length > 0 && <div className="user-chips">{value.map(item => <span key={item.id} className="user-chip" title={detail?.(item) || name(item)}>{name(item)}<button type="button" aria-label={t('移除 {0}', name(item))} onClick={() => onChange(value.filter(current => current.id !== item.id))}><Icon name="close" /></button></span>)}</div>}
    <div className="search-select">
      <input role="combobox" aria-expanded={open} aria-label={label} value={text} placeholder={placeholder} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={event => { setText(event.target.value); setOpen(true); }}
        onKeyDown={event => { if (event.key !== 'Enter') return; event.preventDefault(); if (exact) add(exact); else if (query && choices.length === 1) add(choices[0]); else void createItem(); }} />
      {open && <div className="search-select-options" role="listbox">
        {choices.map(item => <div key={item.id} role="option" aria-selected={false} className="search-select-option" onMouseDown={event => { event.preventDefault(); add(item); }}>{name(item)}{detail?.(item) && <small className="user-option-email"> · {detail(item)}</small>}</div>)}
        {query && !exact && <div role="option" aria-selected={false} className="search-select-option" onMouseDown={event => { event.preventDefault(); void createItem(); }}>{createLabel(text.trim())}</div>}
        {!query && !choices.length && <div className="search-select-status">{emptyLabel}</div>}
      </div>}
    </div>
    {error && <p role="alert" className="source-error">{error}</p>}
  </div>;
}

// Members / permitted users: suggestions by username or email.
export function UserPicker({ value, onChange, label }: { value: User[]; onChange: (users: User[]) => void; label: string }) {
  return <EntityPicker value={value} onChange={onChange} label={label} searchPath="/directory-users" name={user => user.username} detail={user => user.email}
    create={text => api('/directory-users', json(text.includes('@') ? { email: text } : { username: text }))}
    placeholder={t('输入用户名或邮箱搜索，回车添加')} createLabel={text => t('添加新用户“{0}”', text)} emptyLabel={t('暂无用户，输入用户名或邮箱添加')} />;
}

// Departments: pick existing ones or type a new name to create it.
export function DepartmentPicker({ value, onChange, label }: { value: Department[]; onChange: (departments: Department[]) => void; label: string }) {
  return <EntityPicker value={value} onChange={onChange} label={label} searchPath="/departments" name={department => department.name}
    create={text => api('/departments', json({ name: text }))}
    placeholder={t('输入部门名称搜索，回车添加')} createLabel={text => t('新建部门“{0}”', text)} emptyLabel={t('暂无部门，输入名称新建')} />;
}
export function PortalsPage({ onMessage }: { onMessage: (text: string) => void }) {
  useLanguage();
  const [error, setError] = useState('');
  const [portals, setPortals] = useList<PortalItem>('/portals', setError);
  const [reports] = useList<ReportRef>('/dashboards', setError);
  const [form, setForm] = useState<{ id?: string; name: string; report_ids: string[] } | null>(null), [busy, setBusy] = useState(false), [requestedPage, setPage] = useState(0);
  const page = pageOf(requestedPage, portals.length);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  const save = () => run(async () => {
    const saved: PortalItem = await api(form!.id ? `/portals/${form!.id}` : '/portals', { ...json({ name: form!.name, report_ids: form!.report_ids }), method: form!.id ? 'PUT' : 'POST' });
    setPortals(previous => previous.some(item => item.id === saved.id) ? previous.map(item => item.id === saved.id ? saved : item) : [...previous, saved]);
    setForm(null); onMessage(t('已保存'));
  });
  const remove = async (portal: PortalItem) => { if (await confirmAction(t('确定删除 Portal“{0}”？', portal.name))) await run(async () => { await api(`/portals/${portal.id}`, { method: 'DELETE' }); setPortals(previous => previous.filter(item => item.id !== portal.id)); }); };
  const link = (portal: PortalItem) => publicLink('/portal/' + encodeURIComponent(portal.id));
  const toggleReport = (reportId: string, checked: boolean) => setForm(previous => previous && ({ ...previous, report_ids: checked ? [...previous.report_ids, reportId] : previous.report_ids.filter(value => value !== reportId) }));
  return <section className="access-section">
    <header className="reports-heading"><h2>Portal</h2>{!form && <button className="primary" onClick={() => { setForm({ name: '', report_ids: [] }); setError(''); }}>{t('新建')}</button>}</header>
    {form ? <div className="settings-card access-form"><fieldset disabled={busy}>
      <label>{t('Portal 名称')}<input value={form.name} maxLength={255} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <div className="access-field"><span>{t('包含的报表')}</span><div className="access-checklist">{reports.length ? reports.map(report => <label key={report.id}><input type="checkbox" checked={form.report_ids.includes(report.id)} onChange={event => toggleReport(report.id, event.target.checked)} /><span>{report.name}</span>{!report.published && <small>{t('（未发布，Portal 中暂不显示）')}</small>}</label>) : <small>{t('暂无已保存的报表')}</small>}</div><small>{t('Portal 左侧菜单按勾选顺序显示已发布的报表')}</small></div>
      <div className="source-actions"><button type="button" onClick={() => { setForm(null); setError(''); }}>{t('取消')}</button><button type="button" className="primary" disabled={!form.name.trim()} onClick={() => void save()}>{busy ? t('处理中…') : t('保存')}</button></div>
    </fieldset></div> : <>
      <table className="reports-table access-table portals-table"><thead><tr><th>{t('名称')}</th><th>ID</th><th>{t('包含的报表')}</th><th><span className="report-actions-heading">{t('操作')}</span></th></tr></thead><tbody>
        {portals.length ? portals.slice(page * 10, (page + 1) * 10).map(portal => <tr key={portal.id}>
          <td><button className="report-name" disabled={busy} onClick={() => setForm({ id: portal.id, name: portal.name, report_ids: portal.reports.map(report => report.id) })}>{portal.name}</button></td>
          <td className="report-id">{portal.local_id}</td>
          <td title={portal.reports.map(report => report.name).join(', ')}>{portal.reports.length ? portal.reports.map(report => report.name).join(', ') : '—'}</td>
          <td><div className="report-actions">
            <button disabled={busy} onClick={() => void run(async () => { await copyText(await link(portal)); onMessage(t('Portal 链接已复制')); })}><Icon name="link" />{t('复制链接')}</button>
            <button disabled={busy} onClick={() => void run(async () => { window.open(await link(portal), '_blank', 'noopener'); })}><Icon name="view" />{t('查看')}</button>
            <button disabled={busy} onClick={() => setForm({ id: portal.id, name: portal.name, report_ids: portal.reports.map(report => report.id) })}><Icon name="edit" />{t('编辑')}</button>
            <button className="report-delete" disabled={busy} onClick={() => void remove(portal)}><Icon name="delete" />{t('删除')}</button>
          </div></td>
        </tr>) : <tr><td colSpan={4} className="reports-empty">{t('暂无 Portal')}</td></tr>}
      </tbody></table>
      <Pagination page={page} total={portals.length} onChange={setPage} disabled={busy} />
    </>}
    {error && <p role="alert" className="source-error">{error}</p>}
  </section>;
}

type ManagedUser = User & { local_id: number; departments: Department[]; roles: { id: string; name: string }[] };

// Local user list for now; the company account system will replace it later.
export function UsersPage({ onMessage }: { onMessage: (text: string) => void }) {
  useLanguage();
  const [error, setError] = useState('');
  const [users, setUsers] = useList<ManagedUser>('/users', setError);
  const [roles] = useList<RoleItem>('/roles', setError);
  const [form, setForm] = useState<{ id?: string; current?: boolean; username: string; email: string; departments: Department[]; role_ids: string[] } | null>(null), [busy, setBusy] = useState(false), [requestedPage, setPage] = useState(0);
  const page = pageOf(requestedPage, users.length);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  const save = () => run(async () => {
    const saved: ManagedUser = await api(form!.id ? `/users/${form!.id}` : '/users', { ...json({ username: form!.username, email: form!.email, department_ids: form!.departments.map(department => department.id), role_ids: form!.role_ids }), method: form!.id ? 'PUT' : 'POST' });
    setUsers(previous => previous.some(item => item.id === saved.id) ? previous.map(item => item.id === saved.id ? saved : item) : [...previous, saved]);
    setForm(null); onMessage(t('已保存'));
  });
  const remove = async (user: ManagedUser) => { if (await confirmAction(t('确定删除用户“{0}”？会同时从角色和报表权限中移除。', user.username))) await run(async () => { await api(`/users/${user.id}`, { method: 'DELETE' }); setUsers(previous => previous.filter(item => item.id !== user.id)); }); };
  const edit = (user: ManagedUser) => { setForm({ id: user.id, current: user.current, username: user.username, email: user.email, departments: user.departments, role_ids: user.roles.map(role => role.id) }); setError(''); };
  return <section className="access-section">
    <header className="reports-heading"><h2>{t('用户管理')}</h2>{!form && <button className="primary" onClick={() => { setForm({ username: '', email: '', departments: [], role_ids: [] }); setError(''); }}>{t('新建')}</button>}</header>
    {form ? <div className="settings-card access-form"><fieldset disabled={busy}>
      <label>{t('用户名')}<input value={form.username} maxLength={255} readOnly={form.current} placeholder={t('留空时使用邮箱 @ 前的部分')} onChange={event => setForm({ ...form, username: event.target.value })} /></label>
      <label>{t('邮箱')}<input type="email" value={form.email} maxLength={255} readOnly={form.current} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
      {form.current && <small className="access-muted">{t('当前账号的用户名和邮箱在 设置 → 个人资料 中修改')}</small>}
      <div className="access-field"><span>{t('部门')}</span><DepartmentPicker label={t('部门')} value={form.departments} onChange={departments => setForm({ ...form, departments })} /><small>{t('一个用户可以属于多个部门')}</small></div>
      <div className="access-field"><span>{t('角色')}</span><div className="access-checklist">{roles.length ? roles.map(role => <label key={role.id}><input type="checkbox" checked={form.role_ids.includes(role.id)} onChange={event => setForm({ ...form, role_ids: event.target.checked ? [...form.role_ids, role.id] : form.role_ids.filter(value => value !== role.id) })} /><span>{role.name}</span></label>) : <small>{t('暂无角色，请先在角色管理中创建')}</small>}</div><small>{t('一个用户可以属于多个角色')}</small></div>
      <div className="source-actions"><button type="button" onClick={() => { setForm(null); setError(''); }}>{t('取消')}</button><button type="button" className="primary" disabled={!form.username.trim() && !form.email.trim()} onClick={() => void save()}>{busy ? t('处理中…') : t('保存')}</button></div>
    </fieldset></div> : <>
      <table className="reports-table access-table users-table"><thead><tr><th>{t('用户名')}</th><th>ID</th><th>{t('邮箱')}</th><th>{t('部门')}</th><th>{t('角色')}</th><th><span className="report-actions-heading">{t('操作')}</span></th></tr></thead><tbody>
        {users.length ? users.slice(page * 10, (page + 1) * 10).map(user => <tr key={user.id}>
          <td><button className="report-name" disabled={busy} onClick={() => edit(user)}>{user.username}</button>{user.current && <span className="access-tag">{t('当前账号')}</span>}</td>
          <td className="report-id">{user.local_id}</td>
          <td title={user.email}>{user.email || '—'}</td>
          <td title={user.departments.map(department => department.name).join(', ')}>{user.departments.length ? user.departments.map(department => department.name).join(', ') : '—'}</td>
          <td title={user.roles.map(role => role.name).join(', ')}>{user.roles.length ? user.roles.map(role => role.name).join(', ') : '—'}</td>
          <td><div className="report-actions"><button disabled={busy} onClick={() => edit(user)}><Icon name="edit" />{t('编辑')}</button><button className="report-delete" disabled={busy || user.current} title={user.current ? t('当前账号不能删除') : undefined} onClick={() => void remove(user)}><Icon name="delete" />{t('删除')}</button></div></td>
        </tr>) : <tr><td colSpan={6} className="reports-empty">{t('暂无用户')}</td></tr>}
      </tbody></table>
      <Pagination page={page} total={users.length} onChange={setPage} disabled={busy} />
    </>}
    {error && <p role="alert" className="source-error">{error}</p>}
  </section>;
}

export function RolesPage({ onMessage }: { onMessage: (text: string) => void }) {
  useLanguage();
  const [error, setError] = useState('');
  const [roles, setRoles] = useList<RoleItem>('/roles', setError);
  const [form, setForm] = useState<{ id?: string; name: string; members: User[]; departments: Department[] } | null>(null), [busy, setBusy] = useState(false), [requestedPage, setPage] = useState(0);
  const page = pageOf(requestedPage, roles.length);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  const save = () => run(async () => {
    const saved: RoleItem = await api(form!.id ? `/roles/${form!.id}` : '/roles', { ...json({ name: form!.name, member_ids: form!.members.map(user => user.id), department_ids: form!.departments.map(department => department.id) }), method: form!.id ? 'PUT' : 'POST' });
    setRoles(previous => previous.some(item => item.id === saved.id) ? previous.map(item => item.id === saved.id ? saved : item) : [...previous, saved]);
    setForm(null); onMessage(t('已保存'));
  });
  const remove = async (role: RoleItem) => { if (await confirmAction(t('确定删除角色“{0}”？报表权限中的该角色也会移除。', role.name))) await run(async () => { await api(`/roles/${role.id}`, { method: 'DELETE' }); setRoles(previous => previous.filter(item => item.id !== role.id)); }); };
  const edit = (role: RoleItem) => { setForm({ id: role.id, name: role.name, members: role.members, departments: role.departments }); setError(''); };
  return <section className="access-section">
    <header className="reports-heading"><h2>{t('角色管理')}</h2>{!form && <button className="primary" onClick={() => { setForm({ name: '', members: [], departments: [] }); setError(''); }}>{t('新建')}</button>}</header>
    {form ? <div className="settings-card access-form"><fieldset disabled={busy}>
      <label>{t('角色名称')}<input value={form.name} maxLength={255} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <div className="access-field"><span>{t('部门')}</span><DepartmentPicker label={t('部门')} value={form.departments} onChange={departments => setForm({ ...form, departments })} /><small>{t('部门内的所有用户都属于该角色')}</small></div>
      <div className="access-field"><span>{t('用户')}</span><UserPicker label={t('用户')} value={form.members} onChange={members => setForm({ ...form, members })} /><small>{t('一个用户可以属于多个角色')}</small></div>
      <div className="source-actions"><button type="button" onClick={() => { setForm(null); setError(''); }}>{t('取消')}</button><button type="button" className="primary" disabled={!form.name.trim()} onClick={() => void save()}>{busy ? t('处理中…') : t('保存')}</button></div>
    </fieldset></div> : <>
      <table className="reports-table access-table roles-table"><thead><tr><th>{t('名称')}</th><th>ID</th><th>{t('部门')}</th><th>{t('用户')}</th><th>{t('成员数')}</th><th><span className="report-actions-heading">{t('操作')}</span></th></tr></thead><tbody>
        {roles.length ? roles.slice(page * 10, (page + 1) * 10).map(role => <tr key={role.id}>
          <td><button className="report-name" disabled={busy} onClick={() => edit(role)}>{role.name}</button></td>
          <td className="report-id">{role.local_id}</td>
          <td title={role.departments.map(department => department.name).join(', ')}>{role.departments.length ? role.departments.map(department => department.name).join(', ') : '—'}</td>
          <td title={role.members.map(user => user.email || user.username).join(', ')}>{role.members.length ? role.members.map(user => user.username).join(', ') : '—'}</td>
          <td>{role.member_count}</td>
          <td><div className="report-actions"><button disabled={busy} onClick={() => edit(role)}><Icon name="edit" />{t('编辑')}</button><button className="report-delete" disabled={busy} onClick={() => void remove(role)}><Icon name="delete" />{t('删除')}</button></div></td>
        </tr>) : <tr><td colSpan={6} className="reports-empty">{t('暂无角色')}</td></tr>}
      </tbody></table>
      <Pagination page={page} total={roles.length} onChange={setPage} disabled={busy} />
    </>}
    {error && <p role="alert" className="source-error">{error}</p>}
  </section>;
}

// openReportId: opened from the Reports list "权限" button — edit that report's permissions directly.
export function PermissionsPage({ onMessage, openReportId, onOpened }: { onMessage: (text: string) => void; openReportId?: string; onOpened?: () => void }) {
  useLanguage();
  const [error, setError] = useState('');
  const [items, setItems] = useList<PermissionItem>('/report-permissions', setError);
  const [roles] = useList<RoleItem>('/roles', setError);
  const [form, setForm] = useState<{ item: PermissionItem; role_ids: string[]; users: User[] } | null>(null), [busy, setBusy] = useState(false), [requestedPage, setPage] = useState(0);
  const page = pageOf(requestedPage, items.length);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const saved: PermissionItem = await api(`/report-permissions/${form!.item.report_id}`, { ...json({ role_ids: form!.role_ids, user_ids: form!.users.map(user => user.id) }), method: 'PUT' });
      setItems(previous => previous.map(item => item.report_id === saved.report_id ? saved : item)); setForm(null); onMessage(t('已保存'));
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const edit = (item: PermissionItem) => { setForm({ item, role_ids: item.roles.map(role => role.id), users: item.users }); setError(''); };
  useEffect(() => {
    const item = openReportId && items.find(value => value.report_id === openReportId);
    if (item) { edit(item); onOpened?.(); }
  }, [openReportId, items]);
  const everyone = <span className="access-everyone">{t('所有登录用户')}</span>;
  return <section className="access-section">
    <header className="reports-heading"><h2>{t('权限管理')}</h2></header>
    <p className="source-hint">{t('未配置角色和用户的报表，所有登录用户可见。登录与权限校验将在接入公司账号体系后生效。')}</p>
    {form ? <div className="settings-card access-form"><fieldset disabled={busy}>
      <h3>{form.item.report_name}</h3>
      <div className="access-field"><span>{t('角色')}</span><div className="access-checklist">{roles.length ? roles.map(role => <label key={role.id}><input type="checkbox" checked={form.role_ids.includes(role.id)} onChange={event => setForm({ ...form, role_ids: event.target.checked ? [...form.role_ids, role.id] : form.role_ids.filter(value => value !== role.id) })} /><span>{role.name}</span><small>{t('{0} 位成员', role.member_count)}</small></label>) : <small>{t('暂无角色，请先在角色管理中创建')}</small>}</div></div>
      <div className="access-field"><span>{t('用户')}</span><UserPicker label={t('用户')} value={form.users} onChange={users => setForm({ ...form, users })} /></div>
      <div className="source-actions"><button type="button" onClick={() => { setForm(null); setError(''); }}>{t('取消')}</button><button type="button" className="primary" onClick={() => void save()}>{busy ? t('处理中…') : t('保存')}</button></div>
    </fieldset></div> : <>
      <table className="reports-table access-table permissions-table"><thead><tr><th>{t('报表')}</th><th>ID</th><th>{t('角色')}</th><th>{t('用户')}</th><th><span className="report-actions-heading">{t('操作')}</span></th></tr></thead><tbody>
        {items.length ? items.slice(page * 10, (page + 1) * 10).map(item => <tr key={item.report_id}>
          <td><button className="report-name" disabled={busy} onClick={() => edit(item)}>{item.report_name}</button>{!item.published && <small className="access-muted"> · {t('未发布')}</small>}</td>
          <td className="report-id">{item.local_id}</td>
          <td title={item.roles.map(role => role.name).join(', ')}>{item.roles.length ? item.roles.map(role => role.name).join(', ') : item.users.length ? '—' : everyone}</td>
          <td title={item.users.map(user => user.email || user.username).join(', ')}>{item.users.length ? item.users.map(user => user.username).join(', ') : item.roles.length ? '—' : everyone}</td>
          <td><div className="report-actions"><button disabled={busy} onClick={() => edit(item)}><Icon name="edit" />{t('编辑')}</button></div></td>
        </tr>) : <tr><td colSpan={5} className="reports-empty">{t('暂无已保存的报表')}</td></tr>}
      </tbody></table>
      <Pagination page={page} total={items.length} onChange={setPage} disabled={busy} />
    </>}
    {error && <p role="alert" className="source-error">{error}</p>}
  </section>;
}
