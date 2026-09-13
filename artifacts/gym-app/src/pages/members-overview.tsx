import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGetDashboardKpis, useListMembers } from "@workspace/api-client-react";
import type { Member } from "@workspace/api-client-react";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  UserCheck,
  Percent,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";

const PAGE_SIZE = 25;

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

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Active</Badge>;
    case "expired":
      return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Expired</Badge>;
    case "frozen":
      return <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">Frozen</Badge>;
    case "inactive":
      return <Badge variant="secondary">Inactive</Badge>;
    default:
      return <Badge variant="outline">{status || "Unknown"}</Badge>;
  }
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-3 h-9 w-24" />
          ) : (
            <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{sub}</p>
        </div>
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function MembersOverview() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { data: allMembersSummary, isLoading: totalLoading } = useListMembers({
    page: 1,
    limit: 1,
  } as any, {
    query: { queryKey: ["members-overview-total"] },
  });

  const { data: kpis, isLoading: kpisLoading } = useGetDashboardKpis();

  const { data: membersData, isLoading: membersLoading } = useListMembers({
    page,
    limit: PAGE_SIZE,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(status !== "all" && { status }),
    sortBy: "joinDate",
    sortOrder: "desc",
  } as any);

  const totalRegistered = allMembersSummary?.total ?? 0;
  const activeMembers = kpis?.activeMembers.count ?? 0;
  const retention = totalRegistered > 0 ? (activeMembers / totalRegistered) * 100 : 0;

  const members = membersData?.items ?? [];
  const filteredTotal = membersData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Members Overview"
        subtitle="Lifetime membership totals, active customers, retention, and complete member history."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          icon={Users}
          label="Total Registered"
          value={totalRegistered.toLocaleString()}
          sub="All non-deleted members registered since the beginning"
          loading={totalLoading}
        />
        <KpiCard
          icon={UserCheck}
          label="Currently Active"
          value={activeMembers.toLocaleString()}
          sub="Active memberships that have not expired"
          loading={kpisLoading}
        />
        <KpiCard
          icon={Percent}
          label="Retention"
          value={`${retention.toFixed(1)}%`}
          sub="Currently active members ÷ total registered members"
          loading={totalLoading || kpisLoading}
        />
      </div>

      <div className="rounded-2xl border border-border/60 bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border/60 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold">All Registered Members</h2>
            <p className="text-xs text-muted-foreground">
              {filteredTotal.toLocaleString()} {filteredTotal === 1 ? "member" : "members"} shown by current filters
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-[240px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search members..."
                className="pl-9"
              />
            </div>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Filter members by status"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="frozen">Frozen</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-[72px] text-right">View</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {membersLoading ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={7}><Skeleton className="h-7 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-28 text-center text-sm text-muted-foreground">
                    No members found for these filters.
                  </TableCell>
                </TableRow>
              ) : (
                members.map((member: Member) => (
                  <TableRow key={member.id} className="cursor-pointer" onClick={() => navigate(`/members/${member.id}`)}>
                    <TableCell>
                      <div className="font-medium">{member.name}</div>
                      <div className="text-xs text-muted-foreground">#{member.id}</div>
                    </TableCell>
                    <TableCell>{member.phone || "—"}</TableCell>
                    <TableCell>{member.planName || "—"}</TableCell>
                    <TableCell>{statusBadge(member.status)}</TableCell>
                    <TableCell>{formatDate(member.startDate)}</TableCell>
                    <TableCell>{formatDate(member.expiryDate)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`View ${member.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/members/${member.id}`);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-3 border-t border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {filteredTotal.toLocaleString()} total
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || membersLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || membersLoading}
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
