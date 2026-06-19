import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  useGetSettings, useUpdateSettings, getGetSettingsQueryKey,
  useListWhatsappChats, useCreateWhatsappChat, useUpdateWhatsappChat,
  useDeleteWhatsappChat, useTestWhatsappConnection,
  getListWhatsappChatsQueryKey,
} from "@workspace/api-client-react";
import type { WhatsappChat } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Upload, X, ImageIcon, Settings2, Users, MessageCircle,
  Plus, Trash2, Send, Eye, EyeOff, Search, MessageSquare, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LoginUsersTab } from "@/pages/staff";

const BASE = import.meta.env.BASE_URL;

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const token = localStorage.getItem("gym_token");
  const res = await fetch(`${BASE}api/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) throw new Error("Upload failed");
  const json = await res.json();
  return json.url as string;
}

function LogoUpload({
  label, hint, value, onChange,
}: {
  label: string; hint: string;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadFile(file);
      onChange(url);
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium leading-none">{label}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-20 h-20 rounded-lg border-2 border-dashed flex items-center justify-center bg-muted/30 overflow-hidden",
          value ? "border-border" : "border-muted-foreground/30"
        )}>
          {value
            ? <img src={value} alt="logo" className="w-full h-full object-contain" />
            : <ImageIcon className="w-8 h-8 text-muted-foreground/40" />}
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" size="sm" disabled={uploading}
            onClick={() => inputRef.current?.click()}>
            {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
            {t("settings.upload")}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <X className="w-3 h-3 mr-1" />{t("settings.remove")}
            </Button>
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

/* ─── WhatsApp Tab ──────────────────────────────────────────────────────── */

function WhatsAppTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings } = useGetSettings();
  const updateSettings = useUpdateSettings();

  const { data: chats = [], isLoading: chatsLoading } = useListWhatsappChats();
  const createChat = useCreateWhatsappChat();
  const updateChat = useUpdateWhatsappChat();
  const deleteChat = useDeleteWhatsappChat();
  const testConnection = useTestWhatsappConnection();

  const [instanceId, setInstanceId] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [credsSaving, setCredsSaving] = useState(false);

  const [dailyEnabled, setDailyEnabled] = useState(false);
  const [dailyHour, setDailyHour] = useState(21);
  const [dailySaving, setDailySaving] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);

  const [newLabel, setNewLabel] = useState("");
  const [newChatId, setNewChatId] = useState("");
  const [addingChat, setAddingChat] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contacts, setContacts] = useState<{ id: string; name: string; type: string }[]>([]);
  const [contactsFetching, setContactsFetching] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);

  const refetchContacts = async () => {
    setContactsFetching(true);
    setContactsError(null);
    try {
      const token = localStorage.getItem("gym_token");
      const res = await fetch(`${BASE}api/whatsapp/contacts`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setContacts(Array.isArray(data) ? data : []);
      } else {
        const body = await res.json().catch(() => ({}));
        setContactsError(body?.error ?? `Server error ${res.status}`);
      }
    } catch (err) {
      setContactsError("Network error — could not reach the server");
    } finally {
      setContactsFetching(false);
    }
  };

  useEffect(() => {
    if (settings) {
      setInstanceId(settings.greenApiInstanceId ?? "");
      setToken(settings.greenApiToken ?? "");
      setDailyEnabled(settings.dailySummaryEnabled === "true");
      setDailyHour(settings.dailySummaryHour ?? 21);
    }
  }, [settings]);

  const saveDailySettings = () => {
    setDailySaving(true);
    updateSettings.mutate(
      { data: { dailySummaryEnabled: dailyEnabled ? "true" : "false", dailySummaryHour: dailyHour } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          toast({ title: t("common.success") });
          setDailySaving(false);
        },
        onError: () => {
          toast({ title: t("common.error"), variant: "destructive" });
          setDailySaving(false);
        },
      }
    );
  };

  const sendNow = async () => {
    setSendingNow(true);
    try {
      const token = localStorage.getItem("gym_token");
      const res = await fetch(`${BASE}api/whatsapp/send-daily-summary`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        toast({ title: t("settings.summarySent") });
      } else {
        const json = await res.json().catch(() => ({}));
        toast({ title: (json as any).error ?? t("common.error"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    } finally {
      setSendingNow(false);
    }
  };

  const saveCreds = async () => {
    setCredsSaving(true);
    updateSettings.mutate(
      { data: { greenApiInstanceId: instanceId, greenApiToken: token } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          toast({ title: t("common.success") });
          setCredsSaving(false);
        },
        onError: () => {
          toast({ title: t("common.error"), variant: "destructive" });
          setCredsSaving(false);
        },
      }
    );
  };

  const handleAddChat = () => {
    if (!newLabel.trim() || !newChatId.trim()) return;
    createChat.mutate(
      { data: { label: newLabel.trim(), chatId: newChatId.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListWhatsappChatsQueryKey() });
          setNewLabel(""); setNewChatId(""); setAddingChat(false);
        },
        onError: () => toast({ title: t("common.error"), variant: "destructive" }),
      }
    );
  };

  const handleToggle = (chat: WhatsappChat) => {
    updateChat.mutate(
      { id: chat.id, data: { enabled: !chat.enabled } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWhatsappChatsQueryKey() }),
        onError: () => toast({ title: t("common.error"), variant: "destructive" }),
      }
    );
  };

  const handleDelete = (id: number) => {
    deleteChat.mutate(
      { id },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWhatsappChatsQueryKey() }),
        onError: () => toast({ title: t("common.error"), variant: "destructive" }),
      }
    );
  };

  const handleTest = () => {
    testConnection.mutate(undefined, {
      onSuccess: () => toast({ title: t("settings.testSent") }),
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      {/* Credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.whatsapp")}</CardTitle>
          <CardDescription>{t("settings.whatsappDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("settings.greenApiInstanceId")}</label>
              <Input
                value={instanceId}
                onChange={(e) => setInstanceId(e.target.value)}
                placeholder={t("settings.greenApiInstanceIdPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("settings.greenApiToken")}</label>
              <div className="relative">
                <Input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={t("settings.greenApiTokenPlaceholder")}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveCreds} disabled={credsSaving} size="sm">
              {credsSaving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {t("settings.save")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testConnection.isPending || !instanceId || !token}
            >
              {testConnection.isPending
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <Send className="w-3.5 h-3.5 mr-1.5" />}
              {t("settings.sendTest")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Daily Cash Summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4" />
                {t("settings.dailySummary")}
              </CardTitle>
              <CardDescription className="mt-1">{t("settings.dailySummaryDesc")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <label className="text-sm font-medium">{t("settings.dailySummaryEnabled")}</label>
            <Switch
              checked={dailyEnabled}
              onCheckedChange={setDailyEnabled}
            />
          </div>
          {dailyEnabled && (
            <div className="space-y-1.5 max-w-[200px]">
              <label className="text-sm font-medium">{t("settings.dailySummaryHour")}</label>
              <Select value={String(dailyHour)} onValueChange={(v) => setDailyHour(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={saveDailySettings} disabled={dailySaving}>
              {dailySaving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {t("settings.save")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={sendNow}
              disabled={sendingNow || !instanceId || !token}
            >
              {sendingNow
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <Send className="w-3.5 h-3.5 mr-1.5" />}
              {t("settings.sendSummaryNow")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Chat list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">{t("settings.whatsappChats")}</CardTitle>
              <CardDescription className="mt-1">{t("settings.whatsappChatsDesc")}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAddingChat((v) => !v)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />{t("settings.addChat")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Add-chat inline form */}
          {addingChat && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t("settings.chatLabel")}</label>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t("settings.chatLabelPlaceholder")}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t("settings.chatId")}</label>
                <div className="flex gap-2">
                  <Input
                    value={newChatId}
                    onChange={(e) => setNewChatId(e.target.value)}
                    placeholder={t("settings.chatIdPlaceholder")}
                    className="h-8 text-sm flex-1"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 shrink-0"
                    onClick={() => {
                      setContactsOpen(true);
                      setContactSearch("");
                      refetchContacts();
                    }}
                  >
                    <Search className="w-3.5 h-3.5" />
                    {t("settings.browseChats")}
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddChat} disabled={createChat.isPending || !newLabel || !newChatId}>
                  {createChat.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                  {t("common.save")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAddingChat(false); setNewLabel(""); setNewChatId(""); }}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )}

          {/* Contacts picker dialog */}
          <Dialog open={contactsOpen} onOpenChange={setContactsOpen}>
            <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  {t("settings.selectChat")}
                </DialogTitle>
              </DialogHeader>
              <div className="relative mt-1 shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-9"
                  placeholder={t("settings.searchChats")}
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                />
              </div>
              <div className="flex-1 overflow-y-auto min-h-0 mt-2 space-y-1">
                {contactsFetching ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : contactsError ? (
                  <div className="flex flex-col items-center gap-3 py-10 px-4 text-center">
                    <p className="text-sm font-medium text-destructive">{contactsError}</p>
                    <p className="text-xs text-muted-foreground">Check that your Green API Instance ID and Token are saved correctly in settings.</p>
                    <Button size="sm" variant="outline" onClick={refetchContacts}>Retry</Button>
                  </div>
                ) : contacts.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-10 px-4 text-center">
                    <p className="text-sm text-muted-foreground">{t("settings.noContactsFound")}</p>
                    <p className="text-xs text-muted-foreground">Make sure your WhatsApp is connected in Green API and has existing chats.</p>
                    <Button size="sm" variant="outline" onClick={refetchContacts}>Retry</Button>
                  </div>
                ) : (() => {
                  const filtered = contacts.filter((c) => {
                    const q = contactSearch.toLowerCase();
                    return !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
                  });
                  return filtered.length === 0 ? (
                    <div className="text-center py-10 text-sm text-muted-foreground">{t("settings.noContactsFound")}</div>
                  ) : filtered.map((c) => (
                    <button
                      key={c.id}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted text-left transition-colors"
                      onClick={() => {
                        setNewChatId(c.id);
                        if (!newLabel) setNewLabel(c.name);
                        setContactsOpen(false);
                      }}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0",
                        c.type === "group" ? "bg-emerald-500" : "bg-violet-500"
                      )}>
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground font-mono truncate">{c.id}</p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {c.type}
                      </Badge>
                    </button>
                  ));
                })()}
              </div>
            </DialogContent>
          </Dialog>

          {/* Chat rows */}
          {chatsLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : chats.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">{t("settings.noChats")}</div>
          ) : (
            <div className="space-y-2">
              {chats.map((chat) => (
                <div key={chat.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5 bg-background">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{chat.label}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{chat.chatId}</p>
                  </div>
                  <Badge variant={chat.enabled ? "default" : "secondary"} className="text-xs shrink-0">
                    {chat.enabled ? "ON" : "OFF"}
                  </Badge>
                  <Switch
                    checked={chat.enabled ?? true}
                    onCheckedChange={() => handleToggle(chat)}
                    className="shrink-0"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive/70 hover:text-destructive shrink-0"
                    onClick={() => handleDelete(chat.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Main Settings Page ────────────────────────────────────────────────── */

export default function Settings() {
  const { t, setLanguage } = useI18n();
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const formSchema = z.object({
    gymName: z.string().min(1, "Gym name is required"),
    phone: z.string().optional(),
    address: z.string().optional(),
    logoUrl: z.string().nullable().optional(),
    receiptLogoUrl: z.string().nullable().optional(),
    defaultCurrency: z.enum(["USD", "CDF"]),
    usdToCdfRate: z.coerce.number().min(1),
    language: z.enum(["en", "fr", "ar"]),
    backupEnabled: z.string().optional(),
    backupTime: z.string().optional(),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      gymName: "", phone: "", address: "",
      logoUrl: null, receiptLogoUrl: null,
      defaultCurrency: "USD", usdToCdfRate: 2800,
      language: "fr",
      backupEnabled: "false", backupTime: "02:00",
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        gymName: settings.gymName,
        phone: settings.phone ?? "",
        address: settings.address ?? "",
        logoUrl: settings.logoUrl ?? null,
        receiptLogoUrl: settings.receiptLogoUrl ?? null,
        defaultCurrency: settings.defaultCurrency as "USD" | "CDF",
        usdToCdfRate: settings.usdToCdfRate,
        language: settings.language as "en" | "fr" | "ar",
        backupEnabled: settings.backupEnabled ?? "false",
        backupTime: settings.backupTime ?? "02:00",
      });
    }
  }, [settings, form]);

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    updateSettings.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        setLanguage(data.language);
        toast({ title: t("common.success") });
      },
      onError: () => toast({ title: t("common.error"), variant: "destructive" }),
    });
  };

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const rate = form.watch("usdToCdfRate");
  const backupEnabled = form.watch("backupEnabled");

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Settings2}
        iconClass="bg-slate-500/10 text-slate-600 dark:text-slate-400"
        title={t("settings.title")}
        subtitle="Manage your gym configuration and users"
      />

      <Tabs defaultValue="general">
        <TabsList className="h-10 w-full overflow-x-auto flex-nowrap justify-start md:justify-center">
          <TabsTrigger value="general" className="gap-2">
            <Settings2 className="w-3.5 h-3.5" />
            General
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="w-3.5 h-3.5" />
            Users
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-2">
            <MessageCircle className="w-3.5 h-3.5" />
            {t("settings.whatsappTab")}
          </TabsTrigger>
        </TabsList>

        {/* ── General Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="general" className="mt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

              <Card>
                <CardHeader><CardTitle className="text-base">{t("settings.gymInfo")}</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <FormField control={form.control} name="gymName" render={({ field }) => (
                    <FormItem><FormLabel>{t("settings.gymName")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="phone" render={({ field }) => (
                    <FormItem><FormLabel>{t("settings.phone")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="address" render={({ field }) => (
                    <FormItem className="md:col-span-2"><FormLabel>{t("settings.address")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">{t("settings.branding")}</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <LogoUpload
                    label={t("settings.gymLogo")}
                    hint={t("settings.logoHint")}
                    value={form.watch("logoUrl")}
                    onChange={(url) => form.setValue("logoUrl", url)}
                  />
                  <LogoUpload
                    label={t("settings.receiptLogo")}
                    hint={t("settings.logoHint")}
                    value={form.watch("receiptLogoUrl")}
                    onChange={(url) => form.setValue("receiptLogoUrl", url)}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">{t("settings.localization")}</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <FormField control={form.control} name="language" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.language")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="en">English</SelectItem>
                          <SelectItem value="fr">Français</SelectItem>
                          <SelectItem value="ar">العربية</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="defaultCurrency" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.defaultCurrency")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="USD">USD ($)</SelectItem>
                          <SelectItem value="CDF">CDF (FC)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="usdToCdfRate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.usdToCdfRate")}</FormLabel>
                      <FormControl><Input type="number" {...field} /></FormControl>
                      <FormDescription>{t("common.preview")}: $10 = {(10 * (rate || 0)).toLocaleString()} FC</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">{t("settings.backup")}</CardTitle></CardHeader>
                <CardContent className="space-y-5">
                  <FormField control={form.control} name="backupEnabled" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel className="text-sm font-medium">{t("settings.backupEnabled")}</FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value === "true"}
                          onCheckedChange={(v) => field.onChange(v ? "true" : "false")}
                        />
                      </FormControl>
                    </FormItem>
                  )} />
                  {backupEnabled === "true" && (
                    <FormField control={form.control} name="backupTime" render={({ field }) => (
                      <FormItem className="max-w-[200px]">
                        <FormLabel>{t("settings.backupTime")}</FormLabel>
                        <FormControl><Input type="time" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button type="submit" size="lg" disabled={updateSettings.isPending} data-testid="button-save-settings">
                  {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("settings.save")}
                </Button>
              </div>
            </form>
          </Form>
        </TabsContent>

        {/* ── Users Tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="users" className="mt-6">
          <LoginUsersTab />
        </TabsContent>

        {/* ── WhatsApp Tab ───────────────────────────────────────────────────── */}
        <TabsContent value="whatsapp" className="mt-6">
          <WhatsAppTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
