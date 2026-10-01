import { getRoleContext } from "@/lib/auth/roles";
import AttendanceRegisterApp from "./AttendanceRegisterApp";

// Phase 10 — this used to be a server component driving class/section/date
// entirely through URL search params (?date=&class_id=&section_id=), each
// change triggering a full server round trip to re-run the RSC render.
// That's fine online, but offline it means every different class/date
// combination needs its own cached page URL, which a service worker can't
// realistically have pre-cached — "fully offline" needs picking a class,
// section, and date to never require a network round trip at all, which
// means it can't be server-driven the way the old version was. Now this
// page only does the one thing that genuinely needs the server (the
// signed-in user's own role/institute/teacher context) and hands
// everything else — classes, sections, the register, saving — to
// AttendanceRegisterApp, a client component that reads from Supabase when
// online and the offline cache (lib/offline/repositories) when it isn't.
export default async function StudentAttendancePage() {
  const roleContext = await getRoleContext();

  return (
    <AttendanceRegisterApp
      instituteId={roleContext?.instituteId}
      teacherId={roleContext?.teacherId}
      isTeacherOnly={!!roleContext?.isTeacher}
      markedByUserId={roleContext?.userId}
    />
  );
}

