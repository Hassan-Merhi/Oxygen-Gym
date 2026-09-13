import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Member } from "@workspace/api-client-react";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  UserCheck,
  Percent,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const API_PAGE_SIZE = 100;
const MAX_API_PAGES = 100;

type StatusFilter = "all" | "active" | "expired" | "frozen" | "inactive";

type MembersResponse = {
  items: Member[];
  total: number;
  page: number;
  limit: number;
};

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "frozen", label: "Frozen" },
  { value: "inactive", label: "Inactive" },
];

function apiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
}

async function fetchMemberPage(page: number): Promise<MembersResponse> {
  const token = localStorage.getItem("gym_token");
  const params = new URLSearchParams({
    page: String(page),
    limit: String(API_PAGE_SIZE),
    sortBy: "joinDate",
    sortOrder: "desc",
  });
  const response = await fetch(`${apiBaseUrl()}/api/members?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(`Unable to load members (${response.status})`);
  return response.json();
}

async function fetchAllMembers(): Promise<Member[]> {
  const all: Member[] = [];
  let page = 1;
  let expectedTotal = Number.POSITIVE_INFINITY;

  while (page <= MAX_API_PAGES && all.length < expectedTotal) {
    const result = await fetchMemberPage(page);
    expectedTotal = result.total;
    all.push(...result.items);
    if (result.items.length < API_PAGE_SIZE) break;
    page += 1;
  }

  return all;
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function isCurrentlyActive(member: Member, today: Date) {
  if (member.status !== "active" || !member.expiryDate) return false;
  const expiry = new Date(member.expiryDate);
  return !Number.isNaN(expiry.getTime()) && expiry >= today;
}

function effectiveStatus(member: Member, today: Date): StatusFilter | string {
  if (member.status === "active") {
    if (!member.expiryDate) return "inactive";
    const expiry = new Date(member.expiryDate);
    if (!Number.isNaN(expiry.getTime()) && expiry < today) return "expired";
  }
  return member.status;
}

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="border border-emerald-400/20 bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/10">Active</Badge>;
    case "expired":
      return <Badge className="border border-rose-400/20 bg-rose-400/10 text-rose-400 hover:bg-rose-400/10">Expired</Badge>;
    case "frozen":
      return <Badge className="border border-sky-400/20 bg-sky-400/10 text-sky-400 hover:bg-sky-400/10">Frozen</Badge>;
    case "inactive":
      return <Badge className="border border-slate-400/20 bg-slate-400/10 text-slate-300 hover:bg-slate-400/10">Inactive</Badge>;
    default:
      return <Badge variant="outline">{status || "Unknown"}</Badge>;
  }
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "M";
}

function matchesSearch(member: Member, query: string) {
  if (!query) return true;
  const extra = member as Member & { email?: string | null; memberNumber?: string | null };
  const haystack = [member.name, member.phone, extra.email, extra.memberNumber]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  loading,
  tone,
  progress,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  loading: boolean;
  tone: "violet" | "emerald" | "blue";
  progress?: number;
}) {
  const styles = {
    violet: {
      icon: "bg-violet-500/10 text-violet-400 ring-violet-500/20",
      glow: "from-violet-500/10",
      bar: "bg-violet-400",
    },
    emerald: {
      icon: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
      glow: "from-emerald-500/10",
      bar: "bg-emerald-400",
    },
    blue: {
      icon: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
      glow: "from-blue-500/10",
      bar: "bg-blue-400",
    },
  }[tone];

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-lg">
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent opacity-70", styles.glow)} />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-3 h-10 w-24" />
            ) : (
              <p className="mt-2 text-4xl font-bold tracking-tight text-foreground">{value}</p>
            )}
          </div>
          <div className={cn("rounded-xl p-2.5 ring-1 ring-inset", styles.icon)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="mt-3 text-sm leading-5 text-muted-foreground">{sub}</p>
        {progress !== undefined && (
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", styles.bar)}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function MembersOverview() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const {
    data: allMembers = [],
    isLoading,
    isFetching,
    dataUpdatedAt,
  } = useQuery<Member[]>({
    queryKey: ["members-overview-all"],
    queryFn: fetchAllMembers,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const today = useMemo(() => todayStart(), [dataUpdatedAt]);

  const currentActive = useMemo(
    () => allMembers.filter((member) => isCurrentlyActive(member, today)),
    [allMembers, today],
  );

  const totalRegistered = allMembers.length;
  const activeMembers = currentActive.length;
  const retention = totalRegistered > 0 ? (activeMembers / totalRegistered) * 100 : 0;

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: allMembers.length,
      active: 0,
      expired: 0,
      frozen: 0,
      inactive: 0,
    };

    for (const member of allMembers) {
      const effective = effectiveStatus(member, today);
      if (effective === "active" || effective === "expired" || effective === "frozen" || effective === "inactive") {
        counts[effective] += 1;
      }
    }
    return counts;
  }, [allMembers, today]);

  const filteredMembers = useMemo(() => {
    return allMembers.filter((member) => {
      if (!matchesSearch(member, debouncedSearch)) return false;
      if (status === "all") return true;
      return effectiveStatus(member, today) === status;
    });
  }, [allMembers, debouncedSearch, status, today]);

  const filteredTotal = filteredMembers.length;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const members = filteredMembers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const firstShown = filteredTotal === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, filteredTotal);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={Users}
        iconClass="bg-violet-500/10 text-violet-400"
        title="Member Overview"
        subtitle="Live membership health, retention, and complete member history"
        actions={(
          <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs text-muted-foreground sm:flex">
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            <span>{isFetching ? "Refreshing" : lastUpdated ? `Updated ${lastUpdated}` : "Live data"}</span>
          </div>
        )}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          icon={Users}
          label="Total Registered"
          value={totalRegistered.toLocaleString()}
          sub="Every non-deleted member registered since the beginning"
          loading={isLoading}
          tone="violet"
        />
        <KpiCard
          icon={UserCheck}
          label="Currently Active"
          value={activeMembers.toLocaleString()}
          sub="Active memberships whose expiry date has not passed"
          loading={isLoading}
          tone="emerald"
        />
        <KpiCard
          icon={Percent}
          label="Retention"
          value={`${retention.toFixed(1)}%`}
          sub="Currently active members divided by total registered"
          loading={isLoading}
          tone="blue"
          progress={retention}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="border-b border-border/60 p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">Members</h2>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {filteredTotal.toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Search, filter, and open any member profile from one place.
              </p>
            </div>

            <div className="relative w-full xl:w-[320px]">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or phone..."
                className="h-11 rounded-xl border-border/80 bg-background/70 pl-10"
              />
            </div>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => {
                  setStatus(filter.value);
                  setPage(1);
                }}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
                  status === filter.value
                    ? "border-primary/50 bg-primary/15 text-foreground"
                    : "border-border/70 bg-background/40 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {filter.label}
                <span className={cn(
                  "rounded-md px-1.5 py-0.5 text-[11px] tabular-nums",
                  status === filter.value ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                )}>
                  {statusCounts[filter.value].toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/25">
                <th className="w-[23%] px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Member</th>
                <th className="w-[15%] px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Phone</th>
                <th className="w-[20%] px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Plan</th>
                <th className="w-[12%] px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</th>
                <th className="w-[13%] px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Joined</th>
                <th className="w-[13%] px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Expires</th>
                <th className="w-[4%] px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <tr key={index}>
                    <td colSpan={7} className="px-5 py-4"><Skeleton className="h-9 w-full rounded-lg" /></td>
                  </tr>
                ))
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={7} className="h-40 text-center">
                    <div className="mx-auto max-w-sm">
                      <Users className="mx-auto h-8 w-8 text-muted-foreground/35" />
                      <p className="mt-3 font-medium">No members found</p>
                      <p className="mt-1 text-sm text-muted-foreground">Try another status or search term.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                members.map((member) => {
                  const memberStatus = effectiveStatus(member, today);
                  return (
                    <tr
                      key={member.id}
                      className="group cursor-pointer transition-colors hover:bg-muted/30"
                      onClick={() => navigate(`/members/${member.id}`)}
                    >
                      <td className="px-5 py-3.5 align-middle">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary ring-1 ring-inset ring-primary/15">
                            {initials(member.name)}
                          </div>
                          <p className="truncate font-semibold text-foreground" title={member.name}>{member.name}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 align-middle text-muted-foreground">{member.phone || "—"}</td>
                      <td className="px-4 py-3.5 align-middle">
                        <p className="truncate" title={member.planName || ""}>{member.planName || "—"}</p>
                      </td>
                      <td className="px-4 py-3.5 align-middle">{statusBadge(memberStatus)}</td>
                      <td className="px-4 py-3.5 align-middle whitespace-nowrap tabular-nums text-muted-foreground">{formatDate(member.startDate)}</td>
                      <td className="px-4 py-3.5 align-middle whitespace-nowrap tabular-nums text-muted-foreground">{formatDate(member.expiryDate)}</td>
                      <td className="px-3 py-3.5 text-right align-middle">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all group-hover:bg-primary/10 group-hover:text-primary">
                          <ArrowUpRight className="h-4 w-4" />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-border/50 md:hidden">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="p-4"><Skeleton className="h-20 w-full rounded-xl" /></div>
            ))
          ) : members.length === 0 ? (
            <div className="px-4 py-14 text-center text-sm text-muted-foreground">No members found for this view.</div>
          ) : (
            members.map((member) => {
              const memberStatus = effectiveStatus(member, today);
              return (
                <button
                  type="button"
                  key={member.id}
                  onClick={() => navigate(`/members/${member.id}`)}
                  className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/30"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary">
                    {initials(member.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{member.name}</p>
                      {statusBadge(memberStatus)}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{member.planName || "No plan"} · Expires {formatDate(member.expiryDate)}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/10 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-medium text-foreground">{firstShown.toLocaleString()}–{lastShown.toLocaleString()}</span> of{" "}
            <span className="font-medium text-foreground">{filteredTotal.toLocaleString()}</span>
          </p>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-lg"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Button>
            <span className="min-w-[88px] text-center text-xs font-medium text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-lg"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
