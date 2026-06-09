import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useListUsers, useCreateUser, useUpdateUser, useDeleteUser, useUpdateUserPermissions, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Edit2, Trash2, ShieldAlert, Plus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

const PAGE_PERMISSIONS = [
  "dashboard", "members", "plans", "staff", "payroll",
  "payments", "vouchers", "accounts", "stock", "sales", "settings",
] as const;

const FEATURE_PERMISSIONS = [
  "viewCost", "viewProfit", "viewAccounting",
  "manageStaff", "manageSettings", "managePayroll",
  "manageInventory", "manageMembers", "managePlans",
] as const;

const ROLE_COLORS: Record<string, "default" | "secondary" | "outline"> = {
  admin: "default",
  manager: "outline",
  staff: "secondary",
};

export default function Staff() {
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

  const formSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email"),
    phone: z.string().optional(),
    role: z.enum(["admin", "manager", "staff"]),
    status: z.enum(["active", "inactive"]),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", email: "", phone: "", role: "staff", status: "active" },
  });

  const onAddSubmit = (data: z.infer<typeof formSchema>) => {
    createUser.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setIsAddOpen(false);
        form.reset();
        toast({ title: t("common.success") });
      },
      onError: () => toast({ title: t("common.error"), variant: "destructive" })
    });
  };

  const onEditSubmit = (data: z.infer<typeof formSchema>) => {
    if (!selectedUser) return;
    updateUser.mutate({ id: selectedUser.id, data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setIsEditOpen(false);
        toast({ title: t("common.success") });
      },
      onError: () => toast({ title: t("common.error"), variant: "destructive" })
    });
  };

  const handleDelete = () => {
    if (!deleteId) return;
    deleteUser.mutate({ id: deleteId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setDeleteId(null);
        toast({ title: t("common.success") });
      },
      onError: () => toast({ title: t("common.error"), variant: "destructive" })
    });
  };

  const handlePermissionsChange = (key: string, checked: boolean) => {
    if (!selectedUser) return;
    setSelectedUser({ ...selectedUser, permissions: { ...selectedUser.permissions, [key]: checked } });
  };

  const savePermissions = () => {
    if (!selectedUser) return;
    updatePermissions.mutate({ id: selectedUser.id, data: { permissions: selectedUser.permissions } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setIsPermsOpen(false);
        toast({ title: t("common.success") });
      },
      onError: () => toast({ title: t("common.error"), variant: "destructive" })
    });
  };

  const openEdit = (user: any) => {
    setSelectedUser(user);
    form.reset({ name: user.name, email: user.email, phone: user.phone || "", role: user.role, status: user.status });
    setIsEditOpen(true);
  };

  const openPerms = (user: any) => {
    setSelectedUser({ ...user });
    setIsPermsOpen(true);
  };

  const RoleSelect = () => (
    <>
      <SelectItem value="admin">{t("staff.role.admin")}</SelectItem>
      <SelectItem value="manager">{t("staff.role.manager")}</SelectItem>
      <SelectItem value="staff">{t("staff.role.staff")}</SelectItem>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("staff.title")}</h1>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-staff">
              <Plus className="w-4 h-4 mr-2" />
              {t("staff.addStaff")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("staff.addStaff")}</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onAddSubmit)} className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem><FormLabel>{t("staff.table.name")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>{t("staff.table.email")}</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem><FormLabel>{t("staff.table.phone")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="role" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("staff.table.role")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent><RoleSelect /></SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="status" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("staff.table.status")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createUser.isPending}>
                    {createUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("staff.save")}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card rounded-lg border shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("staff.table.name")}</TableHead>
              <TableHead>{t("staff.table.email")}</TableHead>
              <TableHead>{t("staff.table.phone")}</TableHead>
              <TableHead>{t("staff.table.role")}</TableHead>
              <TableHead>{t("staff.table.status")}</TableHead>
              <TableHead className="text-right">{t("staff.table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">{t("common.loading")}</TableCell></TableRow>
            ) : users.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("common.noData")}</TableCell></TableRow>
            ) : (
              users.map(user => (
                <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.phone || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={ROLE_COLORS[user.role] ?? "secondary"}>
                      {t(`staff.role.${user.role}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.status === "active" ? "outline" : "destructive"}>
                      {user.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1 rtl:space-x-reverse">
                    <Button variant="ghost" size="icon" onClick={() => openPerms(user)} title={t("staff.permissions")} data-testid={`btn-perms-${user.id}`}>
                      <ShieldAlert className="w-4 h-4 text-amber-500" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(user)} title={t("staff.edit")} data-testid={`btn-edit-${user.id}`}>
                      <Edit2 className="w-4 h-4 text-blue-500" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteId(user.id)} title={t("staff.delete")} data-testid={`btn-delete-${user.id}`}>
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Modal */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("staff.edit")}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>{t("staff.table.name")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>{t("staff.table.email")}</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>{t("staff.table.phone")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("staff.table.role")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent><RoleSelect /></SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("staff.table.status")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={updateUser.isPending}>
                  {updateUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("staff.save")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Permissions Modal */}
      <Dialog open={isPermsOpen} onOpenChange={setIsPermsOpen}>
        <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("staff.permissions")}: {selectedUser?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Page Access */}
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {t("perm.pageAccess")}
              </p>
              <div className="grid grid-cols-2 gap-y-3 gap-x-6">
                {PAGE_PERMISSIONS.map((key) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm">{t(`perm.${key}`)}</span>
                    <Switch
                      checked={!!selectedUser?.permissions?.[key]}
                      onCheckedChange={(v) => handlePermissionsChange(key, v)}
                    />
                  </div>
                ))}
              </div>
            </div>
            <Separator />
            {/* Feature Access */}
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {t("perm.featureAccess")}
              </p>
              <div className="grid grid-cols-2 gap-y-3 gap-x-6">
                {FEATURE_PERMISSIONS.map((key) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm">{t(`perm.${key}`)}</span>
                    <Switch
                      checked={!!selectedUser?.permissions?.[key]}
                      onCheckedChange={(v) => handlePermissionsChange(key, v)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPermsOpen(false)}>{t("staff.cancel")}</Button>
            <Button onClick={savePermissions} disabled={updatePermissions.isPending}>
              {updatePermissions.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("staff.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Alert */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("staff.delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("staff.confirmDelete")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("staff.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              {deleteUser.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("staff.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
