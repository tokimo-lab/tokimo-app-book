ALTER TABLE containers ADD COLUMN sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE download_tasks ADD COLUMN progress JSONB;
