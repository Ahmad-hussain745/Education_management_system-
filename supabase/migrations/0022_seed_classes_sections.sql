-- ============================================================================
-- 27. SEED DEFAULT CLASSES + SECTIONS
-- ============================================================================
-- Academic Setup (app/(app)/academic/classes, .../sections) has always had
-- full Create/Edit/Deactivate — but nothing ever seeded a starting set, so
-- a fresh project's Class/Section dropdowns (Add Student, Payment Entry,
-- Teacher Class Assignment, ...) are empty until someone manually creates
-- every class one at a time. Seed the common case — Class 1 through
-- Class 12, each with sections A/B/C — so the app is usable immediately;
-- everything here stays fully editable afterward through Academic Setup
-- exactly like a class created by hand.
--
-- on conflict do nothing makes this safe to run against a project that
-- already has some classes/sections of its own (matching names are simply
-- left alone, nothing is overwritten) — relies on classes.name's unique
-- constraint and sections' unique (class_id, name), both from 0001_init.sql.

insert into classes (name, sort_order, status)
select 'Class ' || g, g, 'active'
from generate_series(1, 12) g
on conflict (name) do nothing;

insert into sections (class_id, name)
select c.id, s.name
from classes c
cross join (values ('A'), ('B'), ('C')) as s(name)
where c.name in (select 'Class ' || g from generate_series(1, 12) g)
on conflict (class_id, name) do nothing;
