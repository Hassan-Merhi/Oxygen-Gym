import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers, useCreateUser, useUpdateUser, useDeleteUser, useUpdateUserPermissions, getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Edit2, Loader2, Plus, ShieldAlert, Trash2, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { StaffStatusBadge } from "@/lib/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Avatar } from "./staff-utils";

export const PAGE_PERMISSIONS = [
  "dashboard", "members", "plans", "staff", "payroll",
  "payments", "vouchers", "accounts", "stock", "sales", "settings",
] as const;

export const FEATURE_PERMISSIONS = [
  "viewCost", "viewProfit", "viewAccounting",
  "manageStaff", "manageSettings", "managePayroll",
  "manageInventory", "manageMembers", "managePlans",
  // Allows editing, cancelling and voiding posted payments, vouchers, sales and payroll.
  "approveCorrections",
] as const;

const ROLE_COLORS: Record<string, "default" | "secondary" | "outline"> = {
  admin: "default",
  manager: "outline",
  staff: "secondary",
};

type Permissions = Record<string, boolean>;

export function LoginUsersTab() {
  const { t } = useI18n();
  const { data: users = [], isLoading } = useListUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const updatePermissions = useUpdateUserPermissions();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPermsOpen, setIsPermsOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);

  const formSchema = useMemo(() => z.object({
    username: z.string().min(2, t("users.validation.usernameRequired")).regex(/^[a-z0-9_.-]+$/, t("users.validation.usernameFormat")),
    name: z.string().min(1, t("validation.required")),
    email: z.string().email(t("validation.invalidEmail")).optional().or(z.literal("")),
    phone: z.string().optional(),
    password: z.string().min(6, t("users.validation.passwordMin")).optional().or(z.literal("")),
    role: z.enum(["admin", "manager", "staff"]),
    status: z.enum(["active", "inactive"]),
  }), [t]);
  type FormValues = z.infer<typeof formSchema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: "", name: "", email: "", phone: "", password: "", role: "staff", status: "active" },
  });

  const watchedName = form.watch("name");
  const prevUsernameRef = useRef("");
  useEffect(() => {
    if (!form.getValues("username") || form.getValues("username") === prevUsernameRef.current) {
      const generated = watchedName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      if (generated) { form.setValue("username", generated); prevUsernameRef.current = generated; }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedName]);

  const onAddSubmit = (data: FormValues) => {
    if (!data.password) {
      form.setError("password", { message: t("users.validation.passwordRequired") });
      return;
    }
    createUser.mutate({ data: { username: data.username, name: data.name, email: data.email || undefined, phone: data.phone || undefined, role: data.role, status: data.status, password: data.password } as any }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); setIsAddOpen(false); form.reset(); prevUsernameRef.current = ""; toast({ title: t("common.success") }); },
      onError: (err: any) => toast({ title: err?.data?.error ?? t("common.error"), variant: "destructive" }),
    });
  };

  const onEditSubmit = (data: FormValues) => {
    if (!selectedUser) return;
    updateUser.mutate({ id: selectedUser.id, data: { username: data.username, name: data.name, email: data.email || undefined, phone: data.phone || undefined, role: data.role, status: data.status } as any }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); setIsEditOpen(false); toast({ title: t("common.success") }); },
      onError: (err: any) => toast({ title: err?.data?.error ?? t("common.error"), variant: "destructive" }),
    });
  };

  const handleDelete = () => {
    if (!deleteId) return;
    deleteUser.mutate({ id: deleteId }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); setDeleteId(null); toast({ title: t("common.success") }); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  const handlePermissionsChange = (key: string, checked: boolean) => {
    if (!selectedUser) return;
    setSelectedUser({ ...selectedUser, permissions: { ...(selectedUser.permissions as Permissions), [key]: checked } });
  };

  const savePermissions = () => {
    if (!selectedUser) return;
    updatePermissions.mutate({ id: selectedUser.id, data: { permissions: selectedUser.permissions } }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); setIsPermsOpen(false); toast({ title: t("common.success") }); },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  const openAdd = () => { form.reset(); prevUsernameRef.current = ""; setIsAddOpen(true); };
  const openEdit = (user: any) => {
    setSelectedUser(user);
    prevUsernameRef.current = user.username ?? "";
    form.reset({ username: user.username ?? "", name: user.name, email: user.email ?? "", phone: user.phone || "", password: "", role: user.role, status: user.status });
    setIsEditOpen(true);
  };
  const openPerms = (user: any) => { setSelectedUser({ ...user, permissions: { ...(user.permissions ?? {}) } }); setIsPermsOpen(true); };

  const statusLabel = (s: string) => t(s === "active" ? "users.status.active" : "users.status.inactive");

  const rowActions = (user: any) => (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" onClick={() => openPerms(user)} title={t("staff.permissions")} aria-label={`${t("staff.permissions")} — ${user.name}`} data-testid={`btn-perms-${user.id}`}>
        <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => openEdit(user)} title={t("staff.edit")} aria-label={`${t("staff.edit")} — ${user.name}`} data-testid={`btn-edit-${user.id}`}>
        <Edit2 className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => setDeleteId(user.id)} title={t("staff.delete")} aria-label={`${t("staff.delete")} — ${user.name}`} data-testid={`btn-delete-${user.id}`}>
        <Trash2 className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
      </Button>
    </div>
  );

  // Plain render function (not a component) so inputs keep focus across re-renders.
  const renderUserForm = (mode: "add" | "edit") => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(mode === "add" ? onAddSubmit : onEditSubmit)} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem><FormLabel>{t("staff.table.name")}</FormLabel><FormControl><Input autoComplete="off" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="username" render={({ field }) => (
          <FormItem><FormLabel>{t("auth.username")}</FormLabel><FormControl><Input autoComplete="off" autoCapitalize="none" dir="ltr" className="text-start" {...field} placeholder={mode === "add" ? t("users.usernamePlaceholder") : undefined} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="password" render={({ field }) => (
          <FormItem>
            <FormLabel>{t("auth.password")}{mode === "edit" && <span className="ms-1 text-xs font-normal text-muted-foreground">({t("common.optional")})</span>}</FormLabel>
            <FormControl><Input type="password" autoComplete="new-password" {...field} placeholder="••••••••" /></FormControl><FormMessage />
          </FormItem>
        )} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField control={form.control} name="role" render={({ field }) => (
            <FormItem><FormLabel>{t("staff.table.role")}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="admin">{t("staff.role.admin")}</SelectItem>
                  <SelectItem value="manager">{t("staff.role.manager")}</SelectItem>
                  <SelectItem value="staff">{t("staff.role.staff")}</SelectItem>
                </SelectContent>
              </Select><FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="status" render={({ field }) => (
            <FormItem><FormLabel>{t("staff.table.status")}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="active">{t("users.status.active")}</SelectItem>
                  <SelectItem value="inactive">{t("users.status.inactive")}</SelectItem>
                </SelectContent>
              </Select><FormMessage />
            </FormItem>
          )} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => (mode === "add" ? setIsAddOpen(false) : setIsEditOpen(false))}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={mode === "add" ? createUser.isPending : updateUser.isPending}>
            {(mode === "add" ? createUser.isPending : updateUser.isPending) && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t("staff.save")}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );

  const permissionGroup = (title: string, keys: readonly string[]) => (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</legend>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {keys.map((key) => {
          const id = `perm-${key}`;
          return (
            <div key={key} className="flex min-h-11 items-center justify-between gap-3">
              <label htmlFor={id} className="text-sm">{t(`perm.${key}`)}</label>
              <Switch id={id} checked={!!(selectedUser?.permissions as Permissions | undefined)?.[key]} onCheckedChange={(v) => handlePermissionsChange(key, v)} />
            </div>
          );
        })}
      </div>
    </fieldset>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button data-testid="button-add-staff" onClick={openAdd}>
          <Plus className="h-4 w-4" aria-hidden="true" />{t("staff.addStaff")}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Users className="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium">{t("common.noData")}</p>
        </div>
      ) : (
        <>
          {/* Cards below md */}
          <ul className="space-y-3 md:hidden">
            {users.map(user => (
              <li key={user.id} className="rounded-xl border bg-card p-3 shadow-sm" data-testid={`card-user-${user.id}`}>
                <div className="flex items-center gap-3">
                  <Avatar name={user.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground" dir="ltr">{user.username ?? ""}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={ROLE_COLORS[user.role] ?? "secondary"}>{t(`staff.role.${user.role}`)}</Badge>
                    <StaffStatusBadge status={user.status} label={statusLabel(user.status)} />
                  </div>
                  {rowActions(user)}
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="font-semibold">{t("staff.table.name")}</TableHead>
                  <TableHead className="font-semibold">{t("staff.table.role")}</TableHead>
                  <TableHead className="font-semibold">{t("staff.table.status")}</TableHead>
                  <TableHead className="text-end font-semibold">{t("staff.table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map(user => (
                  <TableRow key={user.id} className="hover:bg-muted/20" data-testid={`row-user-${user.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={user.name} />
                        <div className="min-w-0">
                          <p className="font-medium">{user.name}</p>
                          <p className="text-xs text-muted-foreground" dir="ltr">{user.username ?? ""}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant={ROLE_COLORS[user.role] ?? "secondary"}>{t(`staff.role.${user.role}`)}</Badge></TableCell>
                    <TableCell><StaffStatusBadge status={user.status} label={statusLabel(user.status)} /></TableCell>
                    <TableCell>{rowActions(user)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t("staff.addStaff")}</DialogTitle></DialogHeader>
          {renderUserForm("add")}
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t("staff.edit")}</DialogTitle></DialogHeader>
          {renderUserForm("edit")}
        </DialogContent>
      </Dialog>

      <Dialog open={isPermsOpen} onOpenChange={setIsPermsOpen}>
        <DialogContent className="sm:max-w-[580px]">
          <DialogHeader>
            <DialogTitle>{t("staff.permissions")}: {selectedUser?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {permissionGroup(t("perm.pageAccess"), PAGE_PERMISSIONS)}
            <Separator />
            {permissionGroup(t("perm.featureAccess"), FEATURE_PERMISSIONS)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPermsOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={savePermissions} disabled={updatePermissions.isPending}>
              {updatePermissions.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("staff.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("staff.deleteConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              {deleteUser.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-label={t("common.loading")} /> : t("staff.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
