PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    user_id            INTEGER PRIMARY KEY,
    bitrix_member_id   TEXT,
    bitrix_user_id     TEXT,
    display_name       TEXT NOT NULL,
    email              TEXT,
    global_role        TEXT NOT NULL DEFAULT 'observer'
                       CHECK (global_role IN ('administrator', 'project_manager', 'resource_manager', 'observer')),
    is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at      TEXT,
    UNIQUE (bitrix_member_id, bitrix_user_id)
);

CREATE TABLE IF NOT EXISTS objects (
    object_id          INTEGER PRIMARY KEY,
    object_name        TEXT NOT NULL UNIQUE,
    is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_object_access (
    access_id          INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL,
    object_id          INTEGER NOT NULL,
    object_role        TEXT NOT NULL CHECK (object_role IN ('project_manager', 'observer')),
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (object_id) REFERENCES objects(object_id) ON DELETE CASCADE,
    UNIQUE (user_id, object_id)
);

CREATE TABLE IF NOT EXISTS imports (
    import_id          INTEGER PRIMARY KEY,
    object_id          INTEGER,
    uploaded_by        INTEGER NOT NULL,
    original_name      TEXT NOT NULL,
    stored_name        TEXT,
    stored_path        TEXT,
    sha256             TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'processing'
                       CHECK (status IN ('processing', 'completed', 'failed', 'reverted')),
    inserted_count     INTEGER NOT NULL DEFAULT 0,
    updated_count      INTEGER NOT NULL DEFAULT 0,
    skipped_count      INTEGER NOT NULL DEFAULT 0,
    error_count        INTEGER NOT NULL DEFAULT 0,
    error_message      TEXT,
    imported_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reverted_at        TEXT,
    reverted_by        INTEGER,
    FOREIGN KEY (object_id) REFERENCES objects(object_id),
    FOREIGN KEY (uploaded_by) REFERENCES users(user_id),
    FOREIGN KEY (reverted_by) REFERENCES users(user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_import_sha
ON imports(sha256) WHERE status <> 'reverted';

CREATE TABLE IF NOT EXISTS people_quality_records (
    record_id          INTEGER PRIMARY KEY,
    object_id          INTEGER NOT NULL,
    report_date        TEXT NOT NULL,
    work_type          TEXT NOT NULL,
    detail             TEXT NOT NULL DEFAULT '',
    contractor         TEXT NOT NULL DEFAULT '',
    quality_score      REAL CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 5),
    plan_people        INTEGER CHECK (plan_people IS NULL OR plan_people >= 0),
    actual_people      INTEGER CHECK (actual_people IS NULL OR actual_people >= 0),
    cause              TEXT,
    decision           TEXT,
    work_quality_fact  TEXT,
    discipline_fact    TEXT,
    people_count_fact  TEXT,
    productivity_fact  TEXT,
    cleanliness_fact   TEXT,
    source_import_id   INTEGER NOT NULL,
    source_sheet       TEXT NOT NULL DEFAULT 'Форма отчета',
    source_row         INTEGER NOT NULL,
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (object_id) REFERENCES objects(object_id),
    FOREIGN KEY (source_import_id) REFERENCES imports(import_id),
    UNIQUE (object_id, report_date, work_type, detail, contractor)
);

CREATE INDEX IF NOT EXISTS ix_records_object_date
ON people_quality_records(object_id, report_date);

CREATE INDEX IF NOT EXISTS ix_records_contractor
ON people_quality_records(contractor);

CREATE TABLE IF NOT EXISTS manual_plan_rows (
    plan_row_id         INTEGER PRIMARY KEY,
    object_id           INTEGER NOT NULL,
    work_type           TEXT NOT NULL,
    detail              TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 30),
    contractor          TEXT NOT NULL DEFAULT '' CHECK (length(contractor) <= 30),
    plan_people         INTEGER NOT NULL DEFAULT 0 CHECK (plan_people >= 0),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_by          INTEGER NOT NULL,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (object_id) REFERENCES objects(object_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(user_id),
    UNIQUE (object_id, work_type, detail, contractor)
);

CREATE INDEX IF NOT EXISTS ix_manual_plan_object
ON manual_plan_rows(object_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS manual_dictionary_values (
    dictionary_id       INTEGER PRIMARY KEY,
    category            TEXT NOT NULL CHECK (category IN ('work_type', 'cause')),
    value               TEXT NOT NULL,
    created_by          INTEGER NOT NULL,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(user_id),
    UNIQUE (category, value)
);

CREATE TABLE IF NOT EXISTS report_edit_locks (
    object_id          INTEGER NOT NULL,
    report_date        TEXT NOT NULL,
    user_id            INTEGER NOT NULL,
    expires_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (object_id, report_date),
    FOREIGN KEY (object_id) REFERENCES objects(object_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS object_access_requests (
    request_id         INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL,
    object_id          INTEGER NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at        TEXT,
    resolved_by        INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (object_id) REFERENCES objects(object_id) ON DELETE CASCADE,
    FOREIGN KEY (resolved_by) REFERENCES users(user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_access_request
ON object_access_requests(user_id, object_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS managed_dictionary_values (
    dictionary_id       INTEGER PRIMARY KEY,
    category            TEXT NOT NULL CHECK (category IN ('work_type', 'cause', 'decision', 'contractor', 'resource_measure')),
    value               TEXT NOT NULL,
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_by          INTEGER NOT NULL,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(user_id),
    UNIQUE (category, value)
);

CREATE TABLE IF NOT EXISTS resource_feedback (
    feedback_id         INTEGER PRIMARY KEY,
    object_id           INTEGER NOT NULL,
    report_date         TEXT NOT NULL,
    work_type           TEXT NOT NULL,
    detail              TEXT NOT NULL DEFAULT '',
    contractor          TEXT NOT NULL DEFAULT '',
    comment             TEXT NOT NULL,
    updated_by          INTEGER NOT NULL,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (object_id) REFERENCES objects(object_id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(user_id),
    UNIQUE (object_id, report_date, work_type, detail, contractor)
);

CREATE TABLE IF NOT EXISTS resource_quality_work (
    quality_work_id     INTEGER PRIMARY KEY,
    object_id           INTEGER NOT NULL,
    report_date         TEXT NOT NULL,
    work_type           TEXT NOT NULL,
    detail              TEXT NOT NULL DEFAULT '',
    contractor          TEXT NOT NULL DEFAULT '',
    is_resolved         INTEGER NOT NULL DEFAULT 0 CHECK (is_resolved IN (0, 1)),
    department_measure  TEXT NOT NULL DEFAULT '',
    due_date            TEXT,
    owner               TEXT NOT NULL DEFAULT '',
    comment             TEXT NOT NULL DEFAULT '',
    updated_by          INTEGER NOT NULL,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (object_id) REFERENCES objects(object_id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(user_id),
    UNIQUE (object_id, report_date, work_type, detail, contractor)
);

CREATE TABLE IF NOT EXISTS import_changes (
    change_id          INTEGER PRIMARY KEY,
    import_id          INTEGER NOT NULL,
    record_id          INTEGER NOT NULL,
    change_type        TEXT NOT NULL CHECK (change_type IN ('insert', 'update')),
    previous_data_json TEXT,
    new_data_json      TEXT NOT NULL,
    FOREIGN KEY (import_id) REFERENCES imports(import_id),
    UNIQUE (import_id, record_id)
);

CREATE TABLE IF NOT EXISTS import_errors (
    error_id           INTEGER PRIMARY KEY,
    import_id          INTEGER NOT NULL,
    source_row         INTEGER,
    message            TEXT NOT NULL,
    raw_data_json      TEXT,
    FOREIGN KEY (import_id) REFERENCES imports(import_id) ON DELETE CASCADE
);

CREATE VIEW IF NOT EXISTS v_people_quality_all AS
SELECT
    r.record_id,
    r.object_id,
    o.object_name,
    r.report_date,
    r.work_type,
    r.detail,
    r.contractor,
    r.quality_score,
    r.plan_people,
    r.actual_people,
    CASE
        WHEN r.plan_people IS NOT NULL AND r.actual_people IS NOT NULL
        THEN r.actual_people - r.plan_people
    END AS deviation,
    r.cause,
    r.decision,
    r.work_quality_fact,
    r.discipline_fact,
    r.people_count_fact,
    r.productivity_fact,
    r.cleanliness_fact,
    r.source_import_id,
    r.source_row
FROM people_quality_records r
JOIN objects o ON o.object_id = r.object_id;
