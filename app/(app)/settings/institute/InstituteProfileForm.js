"use client";

import { useState } from "react";
import { updateInstituteProfile } from "./actions";
import { useOnline } from "@/lib/offline/useOnline";
import { ONLINE_REQUIRED_MESSAGE } from "@/lib/offline/online-required";

export default function InstituteProfileForm({ institute }) {
  const [name, setName] = useState(institute?.name || "");
  const [address, setAddress] = useState(institute?.address || "");
  const [phone, setPhone] = useState(institute?.phone || "");
  const [email, setEmail] = useState(institute?.email || "");
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(institute?.logo_url || null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const online = useOnline();

  function handleLogoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // Institute profile is "sensitive settings" — ONLINE REQUIRED, see
    // lib/offline/online-required.js. It also uploads a logo file, which
    // isn't something the offline outbox (built for small JSON rows) is
    // set up to hold.
    if (!online) {
      setMessage({ type: "error", text: ONLINE_REQUIRED_MESSAGE });
      return;
    }
    setSaving(true);
    setMessage(null);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("address", address);
    formData.set("phone", phone);
    formData.set("email", email);
    if (logoFile) formData.set("logo", logoFile);

    const result = await updateInstituteProfile(formData);
    setSaving(false);
    if (result?.error) {
      setMessage({ type: "error", text: result.error });
      return;
    }
    setMessage({ type: "success", text: "Saved. Refresh to see the updated logo everywhere." });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {message && (
        <div
          className={`text-sm rounded-lg px-3 py-2 border ${
            message.type === "error" ? "text-red-700 bg-red-50 border-red-200" : "text-green-700 bg-green-50 border-green-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Logo</label>
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="Institute logo" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs text-slate-400">Logo</span>
            )}
          </div>
          <input type="file" accept="image/*" onChange={handleLogoChange} className="text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Institute name</label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Contact email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {!online && (
        <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          🔒 {ONLINE_REQUIRED_MESSAGE}
        </p>
      )}
      <button
        type="submit"
        disabled={saving || !online}
        className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        {saving ? "Saving..." : "Save changes"}
      </button>
    </form>
  );
}
