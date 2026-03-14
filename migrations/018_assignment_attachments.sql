ALTER TABLE assignments ADD COLUMN attachments TEXT; -- JSON array of { type: 'link', url: string, label?: string }
