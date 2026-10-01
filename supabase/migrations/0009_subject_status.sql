-- ============================================================================
-- 19. SUBJECT STATUS — active/inactive, matching every other reference table
-- ============================================================================
-- subjects had no status column at all — Academic Setup could only ever
-- hard-delete a subject (guarded against one that already has syllabus
-- chapters or teacher assignments). That's the right call when a subject
-- was created by mistake and has nothing built on it yet, but wrong for
-- "we no longer teach Urdu as a separate subject" when years of chapters,
-- topics and progress already exist under it — exactly the same shape as
-- why classes/teachers/discounts all deactivate instead of deleting.

alter table subjects add column if not exists active boolean not null default true;
