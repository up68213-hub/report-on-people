import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { api } from './api.js';
import { ComboBox } from './UiControls.jsx';
import Dialog from './Dialog.jsx';

function keyOf(row) {
  return [row.object_id, row.report_date, row.work_type, row.detail || '', row.contractor || ''].join('\u001f');
}

function payload(row, comment = '') {
  return {
    objectId: Number(row.object_id), reportDate: row.report_date, workType: row.work_type,
    detail: row.detail || '', contractor: row.contractor || '', comment,
  };
}

export default function FeedbackModal({ open, onClose, records, notify }) {
  const exportRef = useRef(null);
  const uniqueRecords = useMemo(() => [...new Map(records.map((row) => [keyOf(row), row])).values()], [records]);
  const [selectedKey, setSelectedKey] = useState('');
  const [comment, setComment] = useState('');
  const [meta, setMeta] = useState(null);
  const [saving, setSaving] = useState(false);
  const selected = uniqueRecords.find((row) => keyOf(row) === selectedKey);

  useEffect(() => {
    if (!open) return;
    setSelectedKey(uniqueRecords[0] ? keyOf(uniqueRecords[0]) : '');
  }, [open, uniqueRecords]);

  useEffect(() => {
    if (!open || !selected) { setComment(''); setMeta(null); return; }
    const params = new URLSearchParams(payload(selected));
    api(`/api/feedback?${params}`).then((data) => {
      setComment(data.feedback?.comment || '');
      setMeta(data.feedback || null);
    }).catch((error) => notify(error.message, 'error'));
  }, [open, selectedKey]);

  if (!open) return null;
  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api('/api/feedback', { method: 'PUT', body: JSON.stringify(payload(selected, comment)) });
      setMeta({ updatedAt: new Date().toISOString(), updatedBy: 'Текущий пользователь' });
      notify('Комментарий Деп.рес. сохранён');
    } catch (error) { notify(error.message, 'error'); }
    finally { setSaving(false); }
  };
  const exportPng = async () => {
    try {
      const canvas = await html2canvas(exportRef.current, { scale: 2, backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--surface') });
      const link = document.createElement('a'); link.download = 'ОС_от_Деп_рес.png'; link.href = canvas.toDataURL('image/png'); link.click();
    } catch (error) { notify(`Не удалось создать PNG: ${error.message}`, 'error'); }
  };
  return <Dialog open={open} onClose={onClose} modalClassName="feedback-modal" title={<>ОС от <span className="accent">Деп.рес.</span></>}
    footerClassName="feedback-foot" footer={<><button onClick={exportPng} disabled={!selected}><span>↓</span> Выгрузить PNG</button><button className="manual-save-btn" onClick={save} disabled={!selected || !comment.trim() || saving}>{saving ? 'Сохранение…' : 'Сохранить комментарий'}</button></>}>
      <div ref={exportRef}>
        <label className="feedback-field"><span>Текущая детализация</span><ComboBox value={selectedKey} onChange={setSelectedKey} options={uniqueRecords.map((row) => ({ value: keyOf(row), label: `${row.contractor || 'Без подрядчика'} · ${row.work_type}${row.detail ? ` · ${row.detail}` : ''}` }))} /></label>
        {selected ? <div className="feedback-card">
          <div className="feedback-context"><strong>{selected.contractor || 'Без подрядчика'}</strong><span>{selected.work_type}{selected.detail ? ` · ${selected.detail}` : ''}</span><span>{new Date(`${selected.report_date}T00:00:00`).toLocaleDateString('ru-RU')}</span></div>
          <label className="feedback-field"><span>Комментарий</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} placeholder="Введите обратную связь по выбранной детализации" /></label>
          {meta && <div className="feedback-meta">Последнее изменение: {meta.updatedBy}, {new Date(meta.updatedAt).toLocaleString('ru-RU')}</div>}
        </div> : <div className="empty-message">Нет строк в текущей детализации отчёта.</div>}
      </div>
  </Dialog>;
}
