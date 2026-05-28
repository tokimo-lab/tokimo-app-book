CREATE TABLE containers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_id UUID,
    source_type VARCHAR(32),
    root_path TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_book_containers_user_id ON containers (user_id);
CREATE INDEX idx_book_containers_source ON containers (source_id, source_type);

CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id UUID NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    author TEXT,
    file_path TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL DEFAULT 'txt',
    size_bytes BIGINT,
    content TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_book_items_container_id ON items (container_id);
