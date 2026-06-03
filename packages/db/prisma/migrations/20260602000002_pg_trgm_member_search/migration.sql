-- Enable pg_trgm for trigram-based fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN indexes on User name + email for fast trigram lookups
-- These make similarity() queries O(log n) instead of O(n)
CREATE INDEX IF NOT EXISTS user_firstname_trgm  ON "User" USING gin (lower("firstName") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS user_lastname_trgm   ON "User" USING gin (lower("lastName")  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS user_fullname_trgm   ON "User" USING gin (lower("firstName" || ' ' || "lastName") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS user_email_trgm      ON "User" USING gin (lower("email") gin_trgm_ops);
