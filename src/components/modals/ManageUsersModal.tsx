"use client";

import { useState, useEffect, FormEvent } from "react";
import { Plus, Pencil, UserX, UserCheck, KeyRound } from "lucide-react";
import Modal, { ModalHeader } from "@/components/shared/Modal";

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: string;
  personnelId: string | null;
  active: boolean;
  personnel: { firstName: string; lastName: string } | null;
}

interface Personnel {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface Props {
  onClose: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  superuser: "Superuser",
  admin: "Admin",
  tech: "Field Tech",
};

const ROLE_BADGE: Record<string, string> = {
  superuser: "bg-purple-100 text-purple-800",
  admin: "bg-blue-100 text-blue-800",
  tech: "bg-emerald-100 text-emerald-800",
};

type View = "list" | "add" | "edit";

export default function ManageUsersModal({ onClose }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("list");
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("admin");
  const [password, setPassword] = useState("");
  const [linkedPersonnelId, setLinkedPersonnelId] = useState("");
  const [active, setActive] = useState(true);

  const loadUsers = async () => {
    const [usersRes, personnelRes] = await Promise.all([
      fetch("/api/users"),
      fetch("/api/dashboard"),
    ]);
    if (usersRes.ok) {
      setUsers(await usersRes.json());
    }
    if (personnelRes.ok) {
      const data = await personnelRes.json();
      setPersonnel(data.personnel ?? []);
    }
    setLoading(false);
  };

  // Intentional: load users + personnel on mount. `loadUsers` is a plain
  // async function reused for later refreshes (after add/edit/deactivate),
  // so it stays a named function rather than an inline effect body.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadUsers(); }, []);

  const openAdd = () => {
    setEditTarget(null);
    setUsername("");
    setDisplayName("");
    setRole("admin");
    setPassword("");
    setLinkedPersonnelId("");
    setActive(true);
    setError(null);
    setView("add");
  };

  const openEdit = (u: UserRow) => {
    setEditTarget(u);
    setUsername(u.username);
    setDisplayName(u.displayName);
    setRole(u.role);
    setPassword("");
    setLinkedPersonnelId(u.personnelId ?? "");
    setActive(u.active);
    setError(null);
    setView("edit");
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) { setError("Password is required for new users"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, displayName, role, password, personnelId: linkedPersonnelId || null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to create user"); return; }
      await loadUsers();
      setView("list");
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        id: editTarget.id,
        displayName,
        role,
        active,
        personnelId: linkedPersonnelId || null,
      };
      if (password) body.password = password;

      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to update user"); return; }
      await loadUsers();
      setView("list");
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: UserRow) => {
    await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, active: !u.active }),
    });
    await loadUsers();
  };

  // Personnel that are already linked to a different user (exclude from picker when adding)
  const linkedPersonnelIds = new Set(users.filter((u) => u.personnelId && u.id !== editTarget?.id).map((u) => u.personnelId!));

  return (
    <Modal onClose={onClose} maxWidth="lg">
      <ModalHeader title="Manage Users" onClose={onClose} />
      <div className="space-y-4">
        {/* Header row */}
        {view === "list" && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">
              {users.length} user{users.length !== 1 ? "s" : ""}
            </p>
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 text-white text-xs font-bold uppercase tracking-wide rounded hover:bg-blue-800 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add User
            </button>
          </div>
        )}

        {/* List view */}
        {view === "list" && (
          loading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : (
            <div className="divide-y divide-zinc-100 border border-zinc-200 rounded">
              {users.map((u) => (
                <div key={u.id} className={`flex items-center gap-3 px-4 py-3 ${!u.active ? "opacity-50" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900 truncate">{u.displayName}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${ROLE_BADGE[u.role] ?? "bg-zinc-100 text-zinc-600"}`}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                      {!u.active && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-red-100 text-red-700">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      @{u.username}
                      {u.personnel && ` · ${u.personnel.firstName} ${u.personnel.lastName}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(u)}
                      title="Edit"
                      className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => toggleActive(u)}
                      title={u.active ? "Deactivate" : "Reactivate"}
                      className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800 transition-colors"
                    >
                      {u.active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Add / Edit form */}
        {(view === "add" || view === "edit") && (
          <form onSubmit={view === "add" ? handleAdd : handleEdit} className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => setView("list")}
                className="text-xs text-zinc-500 hover:text-zinc-800 underline"
              >
                ← Back
              </button>
              <span className="text-sm font-semibold text-zinc-800">
                {view === "add" ? "Add New User" : `Edit: ${editTarget?.username}`}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-zinc-200 rounded text-sm text-zinc-900 focus:outline-none focus:border-zinc-400"
                />
              </div>

              {view === "add" && (
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                    required
                    className="w-full px-3 py-2 border border-zinc-200 rounded text-sm text-zinc-900 focus:outline-none focus:border-zinc-400"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-200 rounded text-sm text-zinc-900 focus:outline-none focus:border-zinc-400"
                >
                  <option value="superuser">Superuser</option>
                  <option value="admin">Admin</option>
                  <option value="tech">Field Tech</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {view === "edit" ? "New Password (optional)" : "Password"}
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required={view === "add"}
                    placeholder={view === "edit" ? "Leave blank to keep" : ""}
                    className="w-full pl-8 pr-3 py-2 border border-zinc-200 rounded text-sm text-zinc-900 focus:outline-none focus:border-zinc-400"
                  />
                </div>
              </div>

              <div className="space-y-1 col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Linked Personnel Record <span className="text-zinc-400 normal-case font-normal">(required for Field Techs)</span>
                </label>
                <select
                  value={linkedPersonnelId}
                  onChange={(e) => setLinkedPersonnelId(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-200 rounded text-sm text-zinc-900 focus:outline-none focus:border-zinc-400"
                >
                  <option value="">None</option>
                  {personnel
                    .filter((p) => !linkedPersonnelIds.has(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.firstName} {p.lastName} ({p.role})
                      </option>
                    ))}
                </select>
              </div>

              {view === "edit" && (
                <div className="space-y-1 col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="active-toggle"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <label htmlFor="active-toggle" className="text-sm text-zinc-700 font-medium">
                    Account Active
                  </label>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-500 font-medium">{error}</p>}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setView("list")}
                className="px-4 py-2 border border-zinc-200 text-zinc-700 text-xs font-bold uppercase tracking-wide rounded hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-700 text-white text-xs font-bold uppercase tracking-wide rounded hover:bg-blue-800 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : view === "add" ? "Create User" : "Save Changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
