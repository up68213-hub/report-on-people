export default function ResourceDepartmentPage() {
  return (
    <div className="resource-prototype-host" style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <iframe
        className="resource-prototype-frame"
        src="/resource-department-workbench.html"
        title="Отработка отклонений — Департамент ресурсов"
        style={{ display: 'block', width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}
