import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Member } from "@workspace/api-client-react";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Pager, EmptyState } from "@/components/ui/pager";
import { StatusBadge } from "@/lib/status-badge";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n-format";
import { useFmtDate } from "@/lib/useFmtDate";
import { Users, UserCheck, Percent, Search, ChevronRight, RefreshCw } from "lucide-react";
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

const STATUS_FILTERS: StatusFilter[] = ["all", "active", "expired", "frozen", "inactive"];

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
    violet: { icon: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-400", bar: "bg-violet-500" },
    emerald: { icon: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400", bar: "bg-emerald-500" },
    blue: { icon: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400", bar: "bg-blue-500" },
  }[tone];

  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-card p-4 shadow-sm md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-3 h-10 w-24" />
          ) : (
            <p className="mt-2 truncate text-3xl font-bold tracking-tight tabular-nums text-foreground lg:text-4xl">{value}</p>
          )}
        </div>
        <div className={cn("shrink-0 rounded-xl p-2.5 ring-1 ring-inset", styles.icon)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-3 text-sm leading-5 text-muted-foreground">{sub}</p>
      {progress !== undefined && (
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div
            className={cn("h-full rounded-full transition-all", styles.bar)}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function MembersOverview() {
  const { t } = useI18n();
  const { fmtDate, fmtTime } = useFmtDate();
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = useMemo(() => todayStart(), [dataUpdatedAt]);

  const currentActive = useMemo(
    () => allMembers.filter((member) => isCurrentlyActive(member, today)),
    [allMembers, today],
  );

  const totalRegistered = allMembers.length;
  const activeMembers = currentActive.length;
  const retention = totalRegistered > 0 ? (activeMembers / totalRegistered) * 100 : 0;

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: allMembers.length, active: 0, expired: 0, frozen: 0, inactive: 0 };
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

  const filterLabel = (f: StatusFilter) => (f === "all" ? t("common.all") : t(`members.status.${f}`));
  const statusLabel = (s: string) => {
    const key = `members.status.${s}`;
    const label = t(key);
    return label === key ? s : label;
  };
  const th = "px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={Users}
        iconClass="bg-violet-500/10 text-violet-700 dark:text-violet-400"
        title={t("overview.title")}
        subtitle={t("overview.subtitle")}
        actions={(
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs text-muted-foreground" aria-live="polite">
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} aria-hidden="true" />
            <span>
              {isFetching
                ? t("overview.refreshing")
                : dataUpdatedAt
                  ? fmt(t("overview.updatedAt"), { time: fmtTime(new Date(dataUpdatedAt)) })
                  : t("overview.live")}
            </span>
          </div>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-3 md:gap-4">
        <KpiCard icon={Users} label={t("overview.kpi.total")} value={totalRegistered.toLocaleString("en-US")} sub={t("overview.kpi.totalSub")} loading={isLoading} tone="violet" />
        <KpiCard icon={UserCheck} label={t("overview.kpi.active")} value={activeMembers.toLocaleString("en-US")} sub={t("overview.kpi.activeSub")} loading={isLoading} tone="emerald" />
        <KpiCard icon={Percent} label={t("overview.kpi.retention")} value={`${retention.toFixed(1)}%`} sub={t("overview.kpi.retentionSub")} loading={isLoading} tone="blue" progress={retention} />
      </div>

      <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm" aria-labelledby="overview-members">
        <div className="border-b border-border/60 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 id="overview-members" className="text-lg font-bold tracking-tight">{t("nav.members")}</h2>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground">
                  {filteredTotal.toLocaleString("en-US")}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("overview.listHint")}</p>
            </div>

            <div className="relative w-full lg:w-[320px]">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("overview.searchPlaceholder")}
                aria-label={t("overview.search")}
                className="h-11 rounded-xl border-border/80 bg-background/70 ps-10"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t("members.table.status")}>
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={status === filter}
                onClick={() => {
                  setStatus(filter);
                  setPage(1);
                }}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11",
                  status === filter
                    ? "border-primary/50 bg-primary/15 text-foreground"
                    : "border-border/70 bg-background/40 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {filterLabel(filter)}
                <span className={cn(
                  "rounded-md px-1.5 py-0.5 text-xs tabular-nums",
                  status === filter ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                )}>
                  {statusCounts[filter].toLocaleString("en-US")}
                </span>
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4" aria-busy="true" aria-label={t("common.loading")}>
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}
          </div>
        ) : members.length === 0 ? (
          <EmptyState icon={Users} title={t("overview.empty")} hint={t("overview.emptyHint")} />
        ) : (
          <>
            {/* Cards below lg */}
            <ul className="divide-y divide-border/50 lg:hidden">
              {members.map((member) => {
                const memberStatus = effectiveStatus(member, today);
                return (
                  <li key={member.id}>
                    <Link
                      href={`/members/${member.id}`}
                      className="flex w-full items-center gap-3 p-4 text-start transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary" aria-hidden="true">
                        {initials(member.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate font-semibold">{member.name}</p>
                          <StatusBadge status={memberStatus} label={statusLabel(memberStatus)} />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {member.planName || t("overview.noPlan")} · {fmt(t("overview.expires"), { date: fmtDate(member.expiryDate) })}
                        </p>
                        {member.phone && <p className="truncate text-xs text-muted-foreground" dir="ltr">{member.phone}</p>}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>

            <table className="hidden w-full table-fixed text-sm lg:table">
              <thead>
                <tr className="border-b border-border/60 bg-muted/25">
                  <th scope="col" className={cn(th, "w-[26%] ps-5")}>{t("members.table.name")}</th>
                  <th scope="col" className={cn(th, "w-[15%]")}>{t("members.table.phone")}</th>
                  <th scope="col" className={cn(th, "w-[19%]")}>{t("members.table.plan")}</th>
                  <th scope="col" className={cn(th, "w-[12%]")}>{t("members.table.status")}</th>
                  <th scope="col" className={cn(th, "w-[12%]")}>{t("overview.col.joined")}</th>
                  <th scope="col" className={cn(th, "w-[12%]")}>{t("members.table.expiry")}</th>
                  <th scope="col" className="w-[4%] px-3 py-3"><span className="sr-only">{t("common.actions")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {members.map((member) => {
                  const memberStatus = effectiveStatus(member, today);
                  return (
                    <tr key={member.id} className="group relative transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3 ps-5 align-middle">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary ring-1 ring-inset ring-primary/15" aria-hidden="true">
                            {initials(member.name)}
                          </div>
                          <Link
                            href={`/members/${member.id}`}
                            className="truncate font-semibold text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                            title={member.name}
                          >
                            {member.name}
                          </Link>
                        </div>
                      </td>
                      <td className="truncate px-4 py-3 align-middle text-muted-foreground"><span dir="ltr">{member.phone || "—"}</span></td>
                      <td className="px-4 py-3 align-middle">
                        <p className="truncate" title={member.planName || ""}>{member.planName || "—"}</p>
                      </td>
                      <td className="px-4 py-3 align-middle"><StatusBadge status={memberStatus} label={statusLabel(memberStatus)} /></td>
                      <td className="whitespace-nowrap px-4 py-3 align-middle tabular-nums text-muted-foreground">{fmtDate(member.startDate)}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-middle tabular-nums text-muted-foreground">{fmtDate(member.expiryDate)}</td>
                      <td className="px-3 py-3 text-end align-middle">
                        <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary rtl:rotate-180" aria-hidden="true" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        <div className="border-t border-border/60 bg-muted/10 px-3 py-3 sm:px-4">
          <Pager
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            summary={fmt(t("overview.showing"), { from: firstShown, to: lastShown, total: filteredTotal })}
          />
        </div>
      </section>
    </div>
  );
}
