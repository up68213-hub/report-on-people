import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

export default function ResourceDepartmentPage({ notify, canEdit, userId }) {
  const frameRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [measures, setMeasures] = useState([]);

  const load = async () => {
    try {
      const result = await api('/api/resource-deviations');
      setRows(result.rows || []);
      setMeasures(result.measures || []);
    } catch (error) {
      notify?.(error.message, 'error');
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (userId == null) return;
    frameRef.current?.contentWindow?.postMessage({ type: 'resource-data', rows, measures, canEdit, userId }, window.location.origin);
  }, [rows, measures, canEdit, userId]);
  useEffect(() => {
    const receive = async (event) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === 'resource-ready') {
        const result = await api('/api/resource-deviations');
        event.source.postMessage({ type: 'resource-data', rows: result.rows || [], measures: result.measures || [], canEdit, userId }, event.origin);
      }
      if (event.data?.type === 'resource-measure-add') {
        try {
          const result = await api('/api/resource-measures', { method: 'POST', body: JSON.stringify({ value: event.data.value }) });
          event.source.postMessage({ type: 'resource-measure-result', ok: true, value: result.value }, event.origin);
        } catch (error) {
          event.source.postMessage({ type: 'resource-measure-result', ok: false, value: event.data.value, message: error.message }, event.origin);
        }
      }
      if (event.data?.type === 'resource-save') {
        try {
          await api('/api/resource-work/quality/batch', {
            method: 'PUT',
            body: JSON.stringify({ rows: (event.data.rows || []).map((row) => ({ objectId: row.objectId,
              reportDate: row.date, workType: row.work, detail: row.det, contractor: row.contr,
              isResolved: row.done, measure: row.measure, dueDate: row.due, owner: row.owner, comment: row.comment })) }),
          });
          event.source.postMessage({ type: 'resource-save-result', ok: true }, event.origin);
          await load();
        } catch (error) {
          event.source.postMessage({ type: 'resource-save-result', ok: false, message: error.message }, event.origin);
        }
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [canEdit, userId]);
  return (
    <div className="resource-prototype-host" style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <iframe
        ref={frameRef}
        className="resource-prototype-frame"
        src="/resource-department-workbench.html"
        title="Отработка подрядчиков — Департамент ресурсов"
        style={{ display: 'block', width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}
