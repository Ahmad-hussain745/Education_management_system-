import { getMyInstitute } from "./actions";
import InstituteProfileForm from "./InstituteProfileForm";

export default async function InstituteSettingsPage() {
  const { institute, error } = await getMyInstitute();

  if (error) {
    return <div className="p-6 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Institute profile</h1>
      <p className="text-sm text-slate-600 mb-6">
        This name and logo appear across the app for everyone at your institute.
      </p>
      <InstituteProfileForm institute={institute} />
    </div>
  );
}
