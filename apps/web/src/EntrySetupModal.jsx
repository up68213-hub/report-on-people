import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { CalendarField, ComboBox } from './UiControls.jsx';
import Dialog from './Dialog.jsx';

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}
const uiDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU') : '';

export default function EntrySetupModal({ open, objects, initialObjectId, onClose, onContinue, notify }) {
  const [options, setOptions] = useState([]);
  const available = useMemo(() => (options.length ? options : objects.map((object) => ({ ...object, hasAccess: true })))
    .filter((object) => object.hasAccess), [objects, options]);
  const [objectId, setObjectId] = useState('');
  const [reportDate, setReportDate] = useState(todayLocal);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const today = todayLocal();

  useEffect(() => {
    if (!open) return;
    let active = true;
    api('/api/object-options').then((data) => { if (active) setOptions(data.objects || []); }).catch(() => { if (active) setOptions([]); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const preferred = initialObjectId !== 'all' && available.some((item) => String(item.id) === String(initialObjectId))
      ? String(initialObjectId) : available.length === 1 ? String(available[0].id) : '';
    setObjectId(preferred); setReportDate(today); setStatus(null);
  }, [open, initialObjectId, available]);

  useEffect(() => {
    const selected = available.find((item) => String(item.id) === String(objectId));
    if (!open || !objectId || !reportDate || !selected?.hasAccess) { setStatus(null); return; }
    let active = true; setLoading(true);
    api(`/api/manual/status?objectId=${encodeURIComponent(objectId)}&reportDate=${encodeURIComponent(reportDate)}`)
      .then((data) => active && setStatus(data)).catch((error) => { if (active) { setStatus(null); notify?.(error.message, 'error'); } })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open, objectId, reportDate, available]);

  if (!open) return null;
  const past = reportDate && reportDate < today; const future = reportDate && reportDate > today;
  const inaccessible = objectId && !available.find((item) => String(item.id) === String(objectId))?.hasAccess;
  const readOnly = past || Boolean(status?.lockedBy);
  const statusTone = status?.lockedBy || (status?.filled > 0 && status.filled < status.total) ? 'warning' : status?.filled > 0 && status.filled === status.total ? 'success' : 'neutral';
  let dateHint = `Будет создано ${status?.total || 0} строк для внесения факта.`;
  if (past) dateHint = `День закрыт: править можно только текущий день, ${uiDate(today)}. Внесено ${status?.filled || 0} из ${status?.total || 0} строк${status?.author ? `, ${status.author}` : ''}.`;
  else if (future) dateHint = 'Дата ещё не наступила. Факт вносится за текущий день.';
  else if (status?.lockedBy) dateHint = `Отчёт сейчас заполняет ${status.lockedBy}. Доступен режим просмотра.`;
  else if (status?.filled) dateHint = `Внесено ${status.filled} из ${status.total} строк${status.author ? `, ${status.author}` : ''}.`;

  const proceed = async () => {
    if (!readOnly) {
      try { await api('/api/manual/lock', { method: 'POST', body: JSON.stringify({ objectId: Number(objectId), reportDate }) }); }
      catch (error) { notify?.(error.message, 'error'); return; }
    }
    onContinue({ objectId, reportDate, readOnly });
  };

  const actionText = readOnly ? 'Открыть для просмотра' : 'Перейти к заполнению';
  return <Dialog open={open} onClose={onClose} overlayClassName="entry-setup-overlay" modalClassName="entry-setup-modal taiga-entry-setup"
    title="Выберите объект и дату отчёта"
    bodyClassName="entry-setup-body" footerClassName="entry-setup-foot" footer={<><button className="taiga-btn flat" onClick={onClose}>Отмена</button><button className="taiga-btn primary" disabled={!objectId || !reportDate || future || inaccessible || loading} onClick={proceed}>{actionText}</button></>}>
      <div className={`taiga-field ${inaccessible ? 'error' : ''}`}><ComboBox value={objectId} onChange={setObjectId} options={available.map((item) => ({ value: item.id, label: item.name }))} placeholder="Выберите объект" /></div>
      <div className={`taiga-field ${future ? 'error' : status?.lockedBy ? 'warning' : ''}`}><CalendarField value={reportDate} onChange={setReportDate} /></div>
    </Dialog>;
}
