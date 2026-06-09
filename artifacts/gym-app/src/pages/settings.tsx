import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, X, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
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
        <div
          className={cn(
            "w-20 h-20 rounded-lg border-2 border-dashed flex items-center justify-center bg-muted/30 overflow-hidden",
            value ? "border-border" : "border-muted-foreground/30"
          )}
        >
          {value ? (
            <img src={value} alt="logo" className="w-full h-full object-contain" />
          ) : (
            <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
            {t("settings.upload")}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <X className="w-3 h-3 mr-1" />
              {t("settings.remove")}
            </Button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

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
    receiptHeader: z.string().optional(),
    receiptFooter: z.string().optional(),
    membershipCardFooter: z.string().optional(),
    backupEnabled: z.string().optional(),
    backupTime: z.string().optional(),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      gymName: "", phone: "", address: "",
      logoUrl: null, receiptLogoUrl: null,
      defaultCurrency: "USD", usdToCdfRate: 2800,
      language: "en",
      receiptHeader: "", receiptFooter: "",
      membershipCardFooter: "",
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
        receiptHeader: settings.receiptHeader ?? "",
        receiptFooter: settings.receiptFooter ?? "",
        membershipCardFooter: settings.membershipCardFooter ?? "",
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
      onError: () => toast({ title: t("common.error"), variant: "destructive" })
    });
  };

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const rate = form.watch("usdToCdfRate");
  const backupEnabled = form.watch("backupEnabled");

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

          {/* Gym Information */}
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

          {/* Branding */}
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

          {/* Localization & Currency */}
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

          {/* Receipt Customization */}
          <Card>
            <CardHeader><CardTitle className="text-base">{t("settings.receipts")}</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-5">
              <FormField control={form.control} name="receiptHeader" render={({ field }) => (
                <FormItem><FormLabel>{t("settings.receiptHeader")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="receiptFooter" render={({ field }) => (
                <FormItem><FormLabel>{t("settings.receiptFooter")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Membership Card */}
          <Card>
            <CardHeader><CardTitle className="text-base">{t("settings.membershipCard")}</CardTitle></CardHeader>
            <CardContent>
              <FormField control={form.control} name="membershipCardFooter" render={({ field }) => (
                <FormItem><FormLabel>{t("settings.membershipCardFooter")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Backup */}
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
    </div>
  );
}
