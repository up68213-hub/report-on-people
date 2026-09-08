import { useEffect, useState } from 'react';
import { api, getDevUserId, setDevUserId } from './api.js';
import { ClearableInput, ComboBox } from './UiControls.jsx';
import Dialog from './Dialog.jsx';

const roleNames = {
  administrator: 'Администратор', project_manager: 'Руководитель проекта', resource_manager: 'Сотрудник Деп. ресурсов', observer: 'Наблюдатель',
};
const categoryNames = { work_type: 'Виды работ', cause: 'Причины', decision: 'Решения', contractor: 'Подрядчики' };

function EditingInput({ value, onSave }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim() || value;
    setDraft(next);
    if (next !== value) onSave(next);
  };
  return <ClearableInput className="admin-inline-clearable" value={draft} title="Enter — сохранить, Esc — отменить"
    onChange={(event) => setDraft(event.target.value)}
    onFocus={(event) => event.target.select()}
    onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { setDraft(value); event.currentTarget.blur(); }
    }} />;
}

export default function AdminPage({ session, notify, onObjectsChanged, onRecordsChanged }) {
  const [users, setUsers] = useState([]);
  const [objects, setObjects] = useState([]);
  const [access, setAccess] = useState([]);
  const [dictionaries, setDictionaries] = useState([]);
  const [tab, setTab] = useState('access');
  const [newObject, setNewObject] = useState('');
  const [category, setCategory] = useState('work_type');
  const [newValue, setNewValue] = useState('');
  const [entries, setEntries] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pendingRevert, setPendingRevert] = useState(null);
  const [accessRequests, setAccessRequests] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [accessDraft, setAccessDraft] = useState(null);

  const load = async () => {
    try {
      const [usersData, objectsData, dictionariesData, requestsData] = await Promise.all([api('/api/admin/users'), api('/api/admin/objects'), api('/api/admin/dictionaries'), api('/api/admin/access-requests')]);
      setUsers(usersData.users); setAccess(usersData.access); setObjects(objectsData.objects); setDictionaries(dictionariesData.values);
      setAccessRequests(requestsData.requests || []);
    } catch (error) { notify(error.message, 'error'); }
  };
  useEffect(() => { if (session?.user.role === 'administrator') load(); }, [session?.user.role]);
  useEffect(() => { if (!selectedUserId && users.length) setSelectedUserId(users[0].id); }, [users, selectedUserId]);
  useEffect(() => {
    const user = users.find((item) => item.id === selectedUserId); if (!user) return;
    setAccessDraft({ role: user.role, isActive: user.isActive, rights: Object.fromEntries(objects.map((object) => [object.id, accessRole(user.id, object.id)])) });
  }, [selectedUserId, users, objects, access]);
  const loadHistory = async () => {
    setHistoryLoading(true);
    try { setEntries((await api('/api/manual/history')).entries); }
    catch (error) { notify(error.message, 'error'); }
    finally { setHistoryLoading(false); }
  };
  useEffect(() => { if (tab === 'history' && session?.user.role === 'administrator') loadHistory(); }, [tab, session?.user.role]);
  if (session?.user.role !== 'administrator') return <div className="section-page"><div className="empty-state"><h2>Раздел недоступен</h2><p>Администрирование доступно только пользователям с ролью администратора.</p></div></div>;

  const request = async (path, options, success, refreshObjects = false) => {
    try { await api(path, options); await load(); if (refreshObjects) await onObjectsChanged?.(); if (success) notify(success); }
    catch (error) { notify(error.message, 'error'); }
  };
  const accessRole = (userId, objectId) => access.find((item) => item.userId === userId && item.objectId === objectId)?.role || 'none';
  const selectedUser = users.find((item) => item.id === selectedUserId);
  const saveAccessDraft = async () => {
    if (!selectedUser || !accessDraft) return;
    try {
      await api(`/api/admin/users/${selectedUser.id}`, { method: 'PATCH', body: JSON.stringify({ role: accessDraft.role, isActive: accessDraft.isActive }) });
      if (accessDraft.role !== 'administrator') await Promise.all(objects.map((object) => api(`/api/admin/users/${selectedUser.id}/access/${object.id}`, { method: 'PUT', body: JSON.stringify({ role: accessDraft.rights[object.id] || 'none' }) })));
      await load(); notify('Права пользователя сохранены');
    } catch (error) { notify(error.message, 'error', saveAccessDraft); }
  };
  const revertEntry = async () => {
    if (!pendingRevert) return;
    try {
      await api(`/api/manual/history/${pendingRevert.id}/revert`, { method: 'POST' });
      setPendingRevert(null);
      await loadHistory(); await onObjectsChanged?.(); await onRecordsChanged?.(); notify('Внесение отменено');
    } catch (error) { notify(error.message, 'error'); }
  };
  return <div className="section-page admin-page">
    <div className="section-header admin-section-header"><div><h1>АДМИНИСТРИРОВАНИЕ</h1><p>Управление пользователями, объектами, правами и справочниками</p></div><div className="admin-tabs section-tabs"><button className={tab === 'access' ? 'active' : ''} onClick={() => setTab('access')}>Пользователи и права</button><button className={tab === 'objects' ? 'active' : ''} onClick={() => setTab('objects')}>Объекты</button><button className={tab === 'catalogs' ? 'active' : ''} onClick={() => setTab('catalogs')}>Справочники</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>История внесений</button></div></div>

    {tab === 'access' && <section className="workspace-card">
      {session.authMode === 'dev' && <div className="dev-banner">Текущий тестовый пользователь:<ComboBox className="admin-combo" value={getDevUserId()} onChange={setDevUserId} options={users.map((user) => ({ value: user.id, label: user.name }))} /></div>}
      {accessRequests.length > 0 && <div className="access-request-list"><h2>Запросы доступа</h2>{accessRequests.map((item) => <div key={item.id}><span><strong>{item.userName}</strong> — {item.objectName}</span><button onClick={() => request(`/api/admin/access-requests/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) }, 'Доступ предоставлен')}>Разрешить</button><button className="people-text-action" onClick={() => request(`/api/admin/access-requests/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) }, 'Запрос отклонён')}>Отклонить</button></div>)}</div>}
      <div className="access-editor"><aside className="access-users">{users.map((user) => <button className={user.id === selectedUserId ? 'active' : ''} key={user.id} onClick={() => setSelectedUserId(user.id)}><strong>{user.name}</strong><span>{roleNames[user.role]} · {user.isActive ? 'активен' : 'отключён'}</span></button>)}</aside>{selectedUser && accessDraft && <section className="access-side"><header><div><h2>{selectedUser.name}</h2><p>{selectedUser.email}</p></div><button className="app-primary" onClick={saveAccessDraft}>Сохранить изменения</button></header><div className="access-user-settings"><label><span>Роль</span><ComboBox value={accessDraft.role} onChange={(role) => setAccessDraft((value) => ({ ...value, role }))} options={Object.entries(roleNames).map(([value, label]) => ({ value, label }))} /></label><label className="status-toggle"><input type="checkbox" checked={accessDraft.isActive} onChange={(event) => setAccessDraft((value) => ({ ...value, isActive: event.target.checked }))} /><span>Пользователь активен</span></label></div><div className="access-object-groups"><h3>Доступ к объектам</h3>{accessDraft.role === 'administrator' ? <p>Администратор имеет доступ ко всем объектам.</p> : objects.map((object) => <label key={object.id}><span>{object.name}</span><ComboBox value={accessDraft.rights[object.id] || 'none'} onChange={(role) => setAccessDraft((value) => ({ ...value, rights: { ...value.rights, [object.id]: role } }))} options={[{ value: 'none', label: 'Нет доступа' }, { value: 'observer', label: 'Просмотр' }, { value: 'project_manager', label: 'Внесение данных' }]} /></label>)}</div><div className="access-mass-actions"><span>Массовые действия:</span><button onClick={() => setAccessDraft((value) => ({ ...value, rights: Object.fromEntries(objects.map((object) => [object.id, 'observer'])) }))}>Просмотр всех</button><button onClick={() => setAccessDraft((value) => ({ ...value, rights: Object.fromEntries(objects.map((object) => [object.id, 'none'])) }))}>Снять весь доступ</button></div></section>}</div>
    </section>}

    {tab === 'objects' && <section className="workspace-card"><form className="new-object-form" onSubmit={(event) => { event.preventDefault(); request('/api/admin/objects', { method: 'POST', body: JSON.stringify({ name: newObject }) }, 'Объект создан', true); setNewObject(''); }}><input value={newObject} onChange={(event) => setNewObject(event.target.value)} placeholder="Название нового объекта" /><button className="app-primary">Добавить объект</button></form><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Название</th><th>Статус</th></tr></thead><tbody>{objects.map((object) => <tr key={object.id}><td><EditingInput value={object.name} onSave={(name) => request(`/api/admin/objects/${object.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }, 'Объект обновлён', true)} /></td><td><label className="status-toggle"><input type="checkbox" checked={object.isActive} onChange={(event) => request(`/api/admin/objects/${object.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: event.target.checked }) }, 'Статус объекта обновлён', true)} /><span>{object.isActive ? 'Активен' : 'Отключён'}</span></label></td></tr>)}</tbody></table></div></section>}

    {tab === 'catalogs' && <section className="workspace-card"><form className="dictionary-form" onSubmit={(event) => { event.preventDefault(); request('/api/admin/dictionaries', { method: 'POST', body: JSON.stringify({ category, value: newValue }) }, 'Значение добавлено'); setNewValue(''); }}><ComboBox className="admin-combo" value={category} onChange={setCategory} options={Object.entries(categoryNames).map(([value, label]) => ({ value, label }))} /><input value={newValue} onChange={(event) => setNewValue(event.target.value)} placeholder="Новое значение" /><button className="app-primary">Добавить</button></form><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Справочник</th><th>Значение</th><th>Статус</th></tr></thead><tbody>{dictionaries.map((item) => <tr key={item.id}><td>{categoryNames[item.category]}</td><td><EditingInput value={item.value} onSave={(value) => request(`/api/admin/dictionaries/${item.id}`, { method: 'PATCH', body: JSON.stringify({ value }) })} /></td><td><label className="status-toggle"><input type="checkbox" checked={item.isActive} onChange={(event) => request(`/api/admin/dictionaries/${item.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: event.target.checked }) })} /><span>{item.isActive ? 'Активно' : 'Скрыто'}</span></label></td></tr>)}</tbody></table></div></section>}

    {tab === 'history' && <section className="workspace-card admin-history-card">
      <div className="workspace-card-head"><div><h2>История внесений</h2><p>Ручные отчёты руководителей проектов и доступные операции отката.</p></div><button className="row-save-button" type="button" onClick={loadHistory} disabled={historyLoading}>Обновить</button></div>
      {historyLoading ? <div className="empty-message">Загрузка…</div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Дата внесения</th><th>Отчёт</th><th>Объект</th><th>Пользователь</th><th>Статус</th><th>Добавлено</th><th>Обновлено</th><th></th></tr></thead><tbody>
        {entries.length ? entries.map((item) => <tr key={item.id}><td>{new Date(`${item.createdAt}Z`).toLocaleString('ru-RU')}</td><td>{item.title}</td><td>{item.objectName}</td><td>{item.createdBy}</td><td><span className={`status status-${item.status}`}>{item.status === 'completed' ? 'Сохранено' : item.status === 'reverted' ? 'Отменено' : item.status}</span></td><td>{item.inserted}</td><td>{item.updated}</td><td className="actions-cell">{item.status === 'completed' && <button disabled={!item.canRevert} onClick={() => setPendingRevert(item)} title={item.canRevert ? 'Отменить внесение' : 'Сначала отмените более новые внесения'}>↶</button>}</td></tr>) : <tr><td colSpan="8" className="empty-cell">История внесений пока пуста.</td></tr>}
      </tbody></table></div>}
    </section>}
    <Dialog open={Boolean(pendingRevert)} onClose={() => setPendingRevert(null)} title="Отменить внесение?" modalClassName="confirm-dialog"
      footer={<div className="confirm-dialog-actions"><button className="manual-cancel-btn" onClick={() => setPendingRevert(null)}>Остаться</button><button className="danger-action" onClick={revertEntry}>Отменить внесение</button></div>}>
      <p>Данные из «{pendingRevert?.title}» будут удалены или восстановлены до предыдущего состояния.</p>
    </Dialog>
  </div>;
}
