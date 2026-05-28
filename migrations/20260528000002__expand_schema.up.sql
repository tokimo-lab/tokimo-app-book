CREATE TABLE chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    idx INT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(item_id, idx)
);

CREATE INDEX idx_book_chapters_item_id ON chapters (item_id);

CREATE TABLE book_sync_status (
    container_id UUID PRIMARY KEY REFERENCES containers(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    last_sync_at TIMESTAMPTZ,
    last_error TEXT,
    progress JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE download_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    provider TEXT NOT NULL,
    query TEXT NOT NULL,
    external_id TEXT,
    status TEXT NOT NULL,
    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_book_download_tasks_user_id ON download_tasks (user_id);
CREATE INDEX idx_book_download_tasks_status ON download_tasks (status);
