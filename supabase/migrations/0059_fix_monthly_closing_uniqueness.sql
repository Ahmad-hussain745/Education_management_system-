-- ============================================================================
-- 59. MONTHLY_CLOSING PER-INSTITUTE UNIQUENESS (found while writing Phase
-- 33's tests, not by inspection — the tests themselves are what caught it)
--
-- 0051's audit fixed is_month_closed() to filter by institute_id, closing
-- the cross-tenant READ/denial-of-service hole (one institute's closed
-- month incorrectly blocking every other institute's postings for that
-- month). It did not touch the table's own constraint, inherited unchanged
-- from 0001_init.sql: `month date not null unique` — a bare, GLOBAL
-- uniqueness constraint on the calendar month alone, not per institute.
--
-- The practical effect: is_month_closed() now correctly answers "is MY
-- August closed," but a second institute trying to actually CLOSE August
-- — insert its own monthly_closing row — would fail outright with a
-- database-level unique_violation, because Postgres only sees one
-- `month` column with no institute_id in its uniqueness check at all.
-- Institute B closing August after Institute A already has isn't a
-- READ-side leak, it's a hard write failure with a confusing error,
-- for every institute on the platform after the first one closes any
-- given month. In a genuinely single-institute deployment this would
-- never surface; the moment a second real institute exists, it's a
-- guaranteed collision the first time both close the same month.
-- ============================================================================

alter table monthly_closing drop constraint if exists monthly_closing_month_key;
alter table monthly_closing add constraint monthly_closing_month_institute_key unique (month, institute_id);
