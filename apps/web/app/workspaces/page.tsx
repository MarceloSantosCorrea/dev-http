"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, LayoutGrid, Lock, Plus, Users, X } from "lucide-react";
import type { WorkspaceMembership, UserRealtimeEvent } from "@devhttp/shared";
import { createRealtimeSocket } from "@/lib/realtime";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  `http://${typeof window !== "undefined" ? window.location.hostname : "localhost"}:4000`;

interface WorkspacesPage {
  data: WorkspaceMembership[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function applyTheme(themeMode: "light" | "dark" | "system") {
  const resolved =
    themeMode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      : themeMode;
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.classList.add(resolved);
  localStorage.setItem("devhttp-theme", themeMode);
}

export default function WorkspacesPage() {
  const router = useRouter();
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    fetch(`${API_BASE_URL}/auth/me`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) { router.push("/"); return; }
        const data = await res.json();
        setUserId(data.user.id);
        setIsAuthLoading(false);
      })
      .catch(() => router.push("/"));
  }, [router]);

  useEffect(() => {
    if (!userId) return;
    const socket = createRealtimeSocket(API_BASE_URL);
    socket.on("user.changed", (event: UserRealtimeEvent) => {
      if (event.userId !== userId) return;
      if (event.entityType !== "preferences") return;
      fetch(`${API_BASE_URL}/preferences`, { credentials: "include" })
        .then((r) => r.json())
        .then((prefs: { themeMode?: string }) => {
          applyTheme((prefs.themeMode ?? "system") as "light" | "dark" | "system");
        })
        .catch(() => {});
    });
    return () => { socket.disconnect(); };
  }, [userId]);

  useEffect(() => {
    if (isAuthLoading) return;
    setPage(1);
  }, [debouncedSearch, isAuthLoading]);

  useEffect(() => {
    if (isAuthLoading) return;
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    setIsLoading(true);
    fetch(`${API_BASE_URL}/workspaces?${params}`, { credentials: "include" })
      .then((res) => res.json())
      .then((data: WorkspacesPage) => {
        setWorkspaces(data.data);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      })
      .finally(() => setIsLoading(false));
  }, [page, debouncedSearch, isAuthLoading]);

  useEffect(() => {
    if (showCreateModal) {
      setTimeout(() => createInputRef.current?.focus(), 50);
    }
  }, [showCreateModal]);

  async function handleCreate() {
    const name = createName.trim();
    if (!name) return;
    setIsCreating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/workspaces`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return;
      setShowCreateModal(false);
      setCreateName("");
      // Reload list
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const listRes = await fetch(`${API_BASE_URL}/workspaces?${params}`, { credentials: "include" });
      const data: WorkspacesPage = await listRes.json();
      setWorkspaces(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } finally {
      setIsCreating(false);
    }
  }

  if (isAuthLoading) return null;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-pri)]">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1.5 text-sm text-[var(--text-sec)] hover:text-[var(--text-pri)] transition-colors"
            >
              <ArrowLeft className="size-4" />
              Voltar
            </button>
            <span className="text-[var(--text-sec)]">/</span>
            <div className="flex items-center gap-2">
              <LayoutGrid className="size-4 text-[var(--text-sec)]" />
              <h1 className="text-base font-semibold">Workspaces</h1>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setCreateName(""); setShowCreateModal(true); }}
            className="flex items-center gap-1.5 rounded bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="size-4" />
            Novo workspace
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search workspaces..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded border border-[var(--bd-str)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-pri)] placeholder:text-[var(--text-sec)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4"
        />

        {/* List */}
        <div className="rounded border border-[var(--bd-str)] overflow-hidden">
          {isLoading ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--text-sec)]">Carregando...</div>
          ) : workspaces.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--text-sec)]">Nenhum workspace encontrado.</div>
          ) : (
            workspaces.map(({ workspace, role }, i) => (
              <div
                key={workspace.id}
                className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-[var(--bd-str)]" : ""}`}
              >
                {role === "owner"
                  ? <Lock className="size-4 shrink-0 text-[var(--text-sec)]" />
                  : <Users className="size-4 shrink-0 text-[var(--text-sec)]" />}
                <span className="flex-1 text-sm font-medium truncate">{workspace.name}</span>
                <span className="text-xs text-[var(--text-sec)] capitalize">{role}</span>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm text-[var(--text-sec)]">
            <span>{total} workspace{total !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                    p === page
                      ? "bg-[var(--brand)] text-white"
                      : "hover:bg-[var(--bg-secondary)] text-[var(--text-sec)]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-lg border border-[var(--bd-str)] bg-[var(--bg-primary)] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Novo workspace</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-[var(--text-sec)] hover:text-[var(--text-pri)] transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
            <input
              ref={createInputRef}
              type="text"
              placeholder="Nome do workspace"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreateModal(false); }}
              className="w-full rounded border border-[var(--bd-str)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-pri)] placeholder:text-[var(--text-sec)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded px-3 py-1.5 text-sm text-[var(--text-sec)] hover:bg-[var(--bg-secondary)] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!createName.trim() || isCreating}
                className="rounded bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isCreating ? "Criando..." : "Criar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
