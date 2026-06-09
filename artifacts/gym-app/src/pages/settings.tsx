import { useEffect } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

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
    defaultCurrency: z.enum(["USD", "CDF"]),
    usdToCdfRate: z.coerce.number().min(1),
    language: z.enum(["en", "fr", "ar"]),
    receiptHeader: z.string().optional(),
    receiptFooter: z.string().optional(),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      gymName: "",
      phone: "",
      address: "",
      defaultCurrency: "USD",
      usdToCdfRate: 2800,
      language: "en",
      receiptHeader: "",
      receiptFooter: ""
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        gymName: settings.gymName,
        phone: settings.phone || "",
        address: settings.address || "",
        defaultCurrency: settings.defaultCurrency,
        usdToCdfRate: settings.usdToCdfRate,
        language: settings.language,
        receiptHeader: settings.receiptHeader || "",
        receiptFooter: settings.receiptFooter || ""
      });
    }
  }, [settings, form]);

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    updateSettings.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        setLanguage(data.language); // Update global UI language
        toast({ title: t("common.success") });
      },
      onError: () => toast({ title: t("common.error"), variant: "destructive" })
    });
  };

  if (isLoading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const rate = form.watch("usdToCdfRate");
  const currency = form.watch("defaultCurrency");

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("settings.title")}</h1>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-lg">General Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField control={form.control} name="gymName" render={({ field }) => (
                <FormItem><FormLabel>{t("settings.gymName")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>{t("settings.phone")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem className="md:col-span-2"><FormLabel>{t("settings.address")}</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Localization & Currency</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
              <div className="hidden md:block"></div>
              
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
                  <FormDescription>Preview: $10 = {10 * (rate || 0)} FC</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Receipts</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-6">
              <FormField control={form.control} name="receiptHeader" render={({ field }) => (
                <FormItem><FormLabel>{t("settings.receiptHeader")}</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="receiptFooter" render={({ field }) => (
                <FormItem><FormLabel>{t("settings.receiptFooter")}</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={updateSettings.isPending} data-testid="button-save-settings">
              {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
              {t("settings.save")}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}