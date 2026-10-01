import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";
import { isMissingDbObjectError } from "@/lib/errors";
import AddStudentForm from "./AddStudentForm";
import OfflineStudentRegistrations from "./OfflineStudentRegistrations";
import DeactivateButton from "./DeactivateButton";
import DeleteButton from "./DeleteButton";
import SearchBox from "@/components/SearchBox";
import Pagination from "@/components/Pagination";
import SortableTh from "@/components/SortableTh";

const PAGE_SIZE = 50;
const VALID_SORTS = new Set(["name_asc", "name_desc", "student_code_asc", "student_code_desc", "class_asc", "class_desc", "status_asc", "status_desc"]);

// The flagship case for the whole "scalable listings" pass: at 5,000+
// students this used to be one unbounded `.select()` (every student, every
// fee_structures row, every time) plus a full-table `<select>` for search.
// Now: one RPC (list_students(), 0029_scalable_listings.sql) does the
// search/filter/sort/page slicing and resolves each row's monthly fee only
// for the ~50 rows actually being shown, and search_students() backs a
// typeahead instead of a giant dropdown anywhere a student needs picking.
export default async function StudentsPage(props) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const rc = await getRoleContext();
  // Mirrors the RLS write policy on students ("write: finance staff" = Super
  // Admin, Accountant) — this only controls whether the buttons render; the
  // database enforces the real rule regardless of what this shows.
  const canWrite = !!(rc?.isAdmin || rc?.isAccountant);

  const search = searchParams?.q || "";
  const classId = searchParams?.class_id || "";
  const sectionId = searchParams?.section_id || "";
  const status = searchParams?.status || "";
  const sort = VALID_SORTS.has(searchParams?.sort) ? searchParams.sort : "name_asc";
  const page = Math.max(1, Number(searchParams?.page) || 1);

  const [{ data: classes }, { data: sections }, { data: rows, error: listError }] = await Promise.all([
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("sections").select("id, name, class_id"),
    supabase.rpc("list_students", {
      p_search: search || null,
      p_class_id: classId || null,
      p_section_id: sectionId || null,
      p_status: status || null,
      p_sort: sort,
      p_page: page,
      p_page_size: PAGE_SIZE,
    }),
  ]);

  const students = rows || [];
  const totalCount = students[0]?.total_count ?? 0;
  const sectionsForClass = (sections || []).filter((s) => !classId || s.class_id === classId);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Students</h1>
          <p className="text-sm text-slate-500 mt-1">{totalCount.toLocaleString()} students on record</p>
        </div>
        {canWrite && <AddStudentForm classes={classes} sections={sections} instituteId={rc?.instituteId} registeredByName={rc?.name || ""} />}
      </div>

      {listError && (
        <div className="bg-brick-tint border border-brick/30 text-brick text-sm rounded-lg px-4 py-3 mb-4">
          <p className="font-medium">Couldn't load the student list.</p>
          <p className="mt-1">
            {listError.message}
            {isMissingDbObjectError(listError.message) && " — the list_students() database function is missing from this Supabase project (or its schema cache hasn't refreshed yet). Run every file in supabase/migrations/ against this project, in order (see README.md → Setup), then reload the schema cache from Settings → API in the Supabase dashboard if it still fails."}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Search</label>
          <SearchBox paramKey="q" placeholder="Name, ID, or guardian…" />
        </div>
        <ClassSectionStatusFilters
          classId={classId}
          sectionId={sectionId}
          status={status}
          classes={classes}
          sectionsForClass={sectionsForClass}
          searchParams={searchParams}
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <SortableTh label="Student ID" sortKey="student_code" currentSort={sort} searchParams={searchParams} />
              <SortableTh label="Name" sortKey="name" currentSort={sort} searchParams={searchParams} />
              <th className="text-left px-4 py-3">Guardian</th>
              <SortableTh label="Class" sortKey="class" currentSort={sort} searchParams={searchParams} />
              <th className="text-right px-4 py-3">Monthly Fee</th>
              <SortableTh label="Status" sortKey="status" currentSort={sort} searchParams={searchParams} />
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{s.student_code || "—"}</td>
                <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {s.guardian_name || "—"}
                  {s.guardian_phone && <div className="text-xs text-slate-400">{s.guardian_phone}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {s.class_name || "—"}{s.section_name ? `-${s.section_name}` : ""}
                </td>
                <td className="px-4 py-3 text-right font-mono">Rs. {Number(s.monthly_fee || 0).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "active" ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <Link href={`/students/${s.id}`} className="text-xs font-medium text-royal hover:underline">
                      View
                    </Link>
                    {canWrite && (
                      <>
                        <Link href={`/students/${s.id}?edit=1`} className="text-xs font-medium text-royal hover:underline">
                          Edit
                        </Link>
                        <DeactivateButton studentId={s.id} status={s.status} />
                        <DeleteButton studentId={s.id} studentName={s.name} />
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {students.length === 0 && !listError && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  {search || classId || sectionId || status ? "No students match this filter." : 'No students yet — click "Add Student" to create the first one.'}
                </td>
              </tr>
            )}
            {students.length === 0 && listError && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">Couldn't load students — see the message above.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination searchParams={searchParams} page={page} pageSize={PAGE_SIZE} totalCount={totalCount} itemLabel="students" />

      {canWrite && <OfflineStudentRegistrations instituteId={rc?.instituteId} />}
    </div>
  );
}

// Plain GET-form selects, server-renderable — no "use client" needed since
// a <select> that submits its enclosing form works without JS. Kept as one
// small inline form so Class/Section/Status apply together in one
// navigation rather than three separate round trips.
function ClassSectionStatusFilters({ classId, sectionId, status, classes, sectionsForClass, searchParams }) {
  const hidden = Object.entries(searchParams || {}).filter(([k]) => !["class_id", "section_id", "status", "page"].includes(k));
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      {hidden.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
        <select name="class_id" defaultValue={classId} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All classes</option>
          {(classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Section</label>
        <select name="section_id" defaultValue={sectionId} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All sections</option>
          {sectionsForClass.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
        <select name="status" defaultValue={status} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <button className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Apply</button>
    </form>
  );
}
