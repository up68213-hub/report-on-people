import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const db = new DatabaseSync(path.resolve('data/report.sqlite'));
db.exec('PRAGMA foreign_keys = ON');

const objectName = 'Демо-проект · Дашборд подрядчиков';
const adminId = db.prepare("SELECT user_id FROM users WHERE global_role='administrator' ORDER BY user_id LIMIT 1").get().user_id;
db.prepare('INSERT INTO objects (object_name) VALUES (?) ON CONFLICT(object_name) DO UPDATE SET is_active=1').run(objectName);
const objectId = db.prepare('SELECT object_id FROM objects WHERE object_name=?').get(objectName).object_id;

const hash = 'demo:contractor-dashboard:v1';
db.prepare(`INSERT INTO imports (object_id, uploaded_by, original_name, sha256, status)
  VALUES (?, ?, ?, ?, 'completed') ON CONFLICT DO NOTHING`).run(objectId, adminId, 'Демонстрационные данные подрядчиков', hash);
const importId = db.prepare('SELECT import_id FROM imports WHERE sha256=?').get(hash).import_id;

const links = [
  { contractor:'ООО «АльфаСтрой»', work:'Монолит', detail:'Корпус А', plan:18, base:11, quality:[2.4,2.8,3.4,4.1], cause:'фронт и материалы есть, нет людей', decision:'Отправить претензию' },
  { contractor:'ООО «АльфаСтрой»', work:'Кладка', detail:'Секция 2', plan:12, base:8, quality:[3.0,3.1,3.5,3.9], cause:'подрядчик не вывел людей', decision:'Затребовано усиление' },
  { contractor:'СК «Вектор»', work:'Фасад', detail:'Южный фасад', plan:14, base:13, quality:[4.4,4.2,3.7,3.2], cause:'низкая производительность', decision:'Отправить уведомление со сроком' },
  { contractor:'СК «Вектор»', work:'Кровля', detail:'Блок Б', plan:9, base:9, quality:[4.1,4.3,4.5,4.6], cause:'', decision:'Мера не требуется' },
  { contractor:'ИП «ЭнергоМонтаж»', work:'Электромонтаж', detail:'Этажи 1–3', plan:16, base:10, quality:[2.7,2.9,3.0,3.3], cause:'люди сняты на другой объект', decision:'Вопрос вынесен на штаб' },
  { contractor:'ООО «ИнжСети»', work:'Слаботочные сети', detail:'Общие зоны', plan:8, base:8, quality:[3.8,4.0,4.2,4.4], cause:'', decision:'Не принял решений' },
];

const weeks = ['2026-08-17','2026-08-24','2026-08-31','2026-09-07'];
const dates = [];
for (const monday of weeks) {
  const start = new Date(`${monday}T12:00:00Z`);
  for (let day=0; day<5; day++) {
    const date = new Date(start); date.setDate(start.getDate()+day);
    const iso = date.toISOString().slice(0,10);
    if (iso <= '2026-09-09') dates.push({ iso, week: weeks.indexOf(monday), day });
  }
}

const facts = {
  5:['Замечаний и предписаний СК нет','Все в СИЗ, нарушений ТБ нет','Явка 90–100% от потребности','План выполнен на 90–100%','Ежедневная уборка, замечаний нет'],
  4:['Несущественные замечания, устранены в срок','Единичные нарушения (1–2 чел.), сразу устранены','Явка 75–90%','Выполнено 75–90%','Мелкий мусор, убирают после замечания'],
  3:['Несущественные замечания, устраняются с задержкой','Регулярно нарушают 10–20% работников','Явка 60–75%','Выполнено 60–75%','Уборка не ежедневная, убирают после напоминания'],
  2:['Критическое замечание (брак) - впервые','Более 30% без СИЗ или грубые нарушения ТБ','Явка 45–60%','Выполнено 45–60%','Убирают после нескольких напоминаний'],
};

const saveRecord = db.prepare(`INSERT INTO people_quality_records
 (object_id,report_date,work_type,detail,contractor,quality_score,plan_people,actual_people,cause,decision,
  work_quality_fact,discipline_fact,people_count_fact,productivity_fact,cleanliness_fact,source_import_id,source_sheet,source_row)
 VALUES (@objectId,@date,@work,@detail,@contractor,@score,@plan,@actual,@cause,@decision,@qf,@sf,@pf,@vf,@cf,@importId,'Демо-данные',@row)
 ON CONFLICT(object_id,report_date,work_type,detail,contractor) DO UPDATE SET
 quality_score=excluded.quality_score,plan_people=excluded.plan_people,actual_people=excluded.actual_people,
 cause=excluded.cause,decision=excluded.decision,work_quality_fact=excluded.work_quality_fact,
 discipline_fact=excluded.discipline_fact,people_count_fact=excluded.people_count_fact,
 productivity_fact=excluded.productivity_fact,cleanliness_fact=excluded.cleanliness_fact,updated_at=CURRENT_TIMESTAMP`);
const savePlan = db.prepare(`INSERT INTO manual_plan_rows
 (object_id,work_type,detail,contractor,plan_people,sort_order,created_by) VALUES (?,?,?,?,?,?,?)
 ON CONFLICT(object_id,work_type,detail,contractor) DO UPDATE SET plan_people=excluded.plan_people,is_active=1`);

db.exec('BEGIN IMMEDIATE');
try {
  db.prepare('DELETE FROM resource_quality_work WHERE object_id=?').run(objectId);
  db.prepare('DELETE FROM people_quality_records WHERE source_import_id=?').run(importId);
  db.prepare('DELETE FROM manual_plan_rows WHERE object_id=?').run(objectId);
  let row = 0;
  links.forEach((link,index) => {
    savePlan.run(objectId,link.work,link.detail,link.contractor,link.plan,index,adminId);
    dates.forEach(({iso,week,day}) => {
      const improving = index === 0 || index === 1 || index === 4;
      const shift = improving ? week : -Math.max(0,week-1);
      const actual = Math.max(0,Math.min(link.plan,link.base + shift + ((day+index)%3===0?1:0)));
      const score = link.quality[week];
      const grade = Math.max(2,Math.min(5,Math.round(score)));
      const f = facts[grade];
      saveRecord.run({ objectId,date:iso,work:link.work,detail:link.detail,contractor:link.contractor,
        score,plan:link.plan,actual,cause:actual<link.plan?link.cause:'',decision:link.decision,
        qf:f[0],sf:f[1],pf:f[2],vf:f[3],cf:f[4],importId,row:++row });
    });
  });
  const saveWork = db.prepare(`INSERT INTO resource_quality_work
   (object_id,report_date,work_type,detail,contractor,is_resolved,department_measure,owner,comment,updated_by)
   VALUES (?,?,?,?,?,1,?,?,?,?) ON CONFLICT(object_id,report_date,work_type,detail,contractor) DO UPDATE SET
   is_resolved=1,department_measure=excluded.department_measure,owner=excluded.owner,comment=excluded.comment,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`);
  saveWork.run(objectId,'2026-08-28','Монолит','Корпус А','ООО «АльфаСтрой»','Претензия','Сотрудник Деп. ресурсов','Подрядчик подтвердил вывод дополнительной бригады.',adminId);
  saveWork.run(objectId,'2026-09-04','Электромонтаж','Этажи 1–3','ИП «ЭнергоМонтаж»','Вопрос вынесен на штаб','Сотрудник Деп. ресурсов','Нужен контроль фактического выхода людей 7 сентября.',adminId);
  saveWork.run(objectId,'2026-09-09','Монолит','Корпус А','ООО «АльфаСтрой»','План корректирующих действий','Сотрудник Деп. ресурсов','Усиление выполнено частично, динамика положительная.',adminId);
  saveWork.run(objectId,'2026-09-09','Фасад','Южный фасад','СК «Вектор»','Внеплановая проверка на объекте','Сотрудник Деп. ресурсов','Качество снижается, назначена повторная проверка.',adminId);
  db.prepare('UPDATE imports SET inserted_count=?, status=\'completed\' WHERE import_id=?').run(row,importId);
  db.exec('COMMIT');
  console.log(JSON.stringify({ objectId, objectName, records: row, contractors: new Set(links.map(x=>x.contractor)).size }, null, 2));
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
