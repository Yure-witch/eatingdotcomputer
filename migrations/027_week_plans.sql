-- Week plan checklist system
CREATE TABLE IF NOT EXISTS week_plans (
    id            TEXT NOT NULL PRIMARY KEY,
    week          INTEGER NOT NULL,
    headline      TEXT NOT NULL,
    topic_preview TEXT,
    due_date      TEXT,
    class_id      TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(class_id, week)
);

CREATE TABLE IF NOT EXISTS week_items (
    id                  TEXT NOT NULL PRIMARY KEY,
    week_plan_id        TEXT NOT NULL REFERENCES week_plans(id) ON DELETE CASCADE,
    label               TEXT NOT NULL,
    requires_submission INTEGER NOT NULL DEFAULT 0,
    accepted_types      TEXT NOT NULL DEFAULT '["link"]',
    resource_url        TEXT,
    resource_label      TEXT,
    resource_filename   TEXT,
    resource_mimetype   TEXT,
    sort_order          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS item_completions (
    id               TEXT NOT NULL PRIMARY KEY,
    item_id          TEXT NOT NULL REFERENCES week_items(id) ON DELETE CASCADE,
    student_id       TEXT NOT NULL,
    completed_at     TEXT NOT NULL DEFAULT (datetime('now')),
    submission_type  TEXT,
    submission_value TEXT,
    UNIQUE(item_id, student_id)
);
