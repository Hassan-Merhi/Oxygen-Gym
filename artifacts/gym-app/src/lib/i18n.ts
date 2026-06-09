import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect } from "react";

type Language = "en" | "fr" | "ar";

interface Translations {
  [key: string]: string;
}

const en: Translations = {
  "nav.dashboard": "Dashboard",
  "nav.members": "Members",
  "nav.plans": "Plans",
  "nav.staff": "Staff",
  "nav.payroll": "Payroll",
  "nav.payments": "Payments",
  "nav.vouchers": "Vouchers",
  "nav.accounts": "Accounts",
  "nav.stock": "Stock",
  "nav.sales": "Sales",
  "nav.settings": "Settings",
  "nav.logout": "Log Out",
  "nav.comingSoon": "Coming Soon",
  
  "dashboard.title": "Command Center",
  "dashboard.activeMembers": "Active Members",
  "dashboard.monthlyRevenue": "Monthly Revenue",
  "dashboard.monthlyExpenses": "Monthly Expenses",
  "dashboard.todayCheckins": "Today's Check-ins",
  "dashboard.expiringSoon": "Expiring Soon",
  "dashboard.lowStock": "Low Stock",
  "dashboard.totalProfit": "Total Profit",
  "dashboard.welcome": "Welcome back",

  "staff.title": "Staff Management",
  "staff.addStaff": "Add Staff",
  "staff.table.name": "Name",
  "staff.table.email": "Email",
  "staff.table.phone": "Phone",
  "staff.table.role": "Role",
  "staff.table.status": "Status",
  "staff.table.permissions": "Permissions",
  "staff.table.actions": "Actions",
  "staff.edit": "Edit",
  "staff.delete": "Delete",
  "staff.confirmDelete": "Are you sure you want to delete this staff member?",
  "staff.permissions": "Edit Permissions",
  "staff.save": "Save Changes",
  "staff.cancel": "Cancel",
  
  "settings.title": "Gym Settings",
  "settings.gymName": "Gym Name",
  "settings.phone": "Phone Number",
  "settings.address": "Physical Address",
  "settings.defaultCurrency": "Default Currency",
  "settings.usdToCdfRate": "USD to CDF Exchange Rate",
  "settings.language": "System Language",
  "settings.receiptHeader": "Receipt Header Text",
  "settings.receiptFooter": "Receipt Footer Message",
  "settings.save": "Save Settings",
  
  "common.loading": "Loading...",
  "common.error": "An error occurred",
  "common.success": "Operation successful",
  "common.noData": "No data available",
  "common.comingSoonMsg": "This feature is currently under development. Please check back later."
};

const fr: Translations = {
  "nav.dashboard": "Tableau de Bord",
  "nav.members": "Membres",
  "nav.plans": "Abonnements",
  "nav.staff": "Personnel",
  "nav.payroll": "Paie",
  "nav.payments": "Paiements",
  "nav.vouchers": "Bons",
  "nav.accounts": "Comptes",
  "nav.stock": "Stock",
  "nav.sales": "Ventes",
  "nav.settings": "Paramètres",
  "nav.logout": "Déconnexion",
  "nav.comingSoon": "À Venir",

  "dashboard.title": "Centre de Commandement",
  "dashboard.activeMembers": "Membres Actifs",
  "dashboard.monthlyRevenue": "Revenu Mensuel",
  "dashboard.monthlyExpenses": "Dépenses Mensuelles",
  "dashboard.todayCheckins": "Présences du Jour",
  "dashboard.expiringSoon": "Expire Bientôt",
  "dashboard.lowStock": "Stock Faible",
  "dashboard.totalProfit": "Bénéfice Total",
  "dashboard.welcome": "Bon retour",

  "staff.title": "Gestion du Personnel",
  "staff.addStaff": "Ajouter du Personnel",
  "staff.table.name": "Nom",
  "staff.table.email": "Email",
  "staff.table.phone": "Téléphone",
  "staff.table.role": "Rôle",
  "staff.table.status": "Statut",
  "staff.table.permissions": "Permissions",
  "staff.table.actions": "Actions",
  "staff.edit": "Modifier",
  "staff.delete": "Supprimer",
  "staff.confirmDelete": "Êtes-vous sûr de vouloir supprimer ce membre du personnel ?",
  "staff.permissions": "Modifier les Permissions",
  "staff.save": "Enregistrer les modifications",
  "staff.cancel": "Annuler",
  
  "settings.title": "Paramètres du Gymnase",
  "settings.gymName": "Nom du Gymnase",
  "settings.phone": "Numéro de Téléphone",
  "settings.address": "Adresse Physique",
  "settings.defaultCurrency": "Devise par Défaut",
  "settings.usdToCdfRate": "Taux de Change USD vers CDF",
  "settings.language": "Langue du Système",
  "settings.receiptHeader": "Texte d'En-tête du Reçu",
  "settings.receiptFooter": "Message de Pied de Page du Reçu",
  "settings.save": "Enregistrer les Paramètres",
  
  "common.loading": "Chargement...",
  "common.error": "Une erreur s'est produite",
  "common.success": "Opération réussie",
  "common.noData": "Aucune donnée disponible",
  "common.comingSoonMsg": "Cette fonctionnalité est en cours de développement. Veuillez revenir plus tard."
};

const ar: Translations = {
  "nav.dashboard": "لوحة القيادة",
  "nav.members": "الأعضاء",
  "nav.plans": "الخطط",
  "nav.staff": "الموظفين",
  "nav.payroll": "الرواتب",
  "nav.payments": "المدفوعات",
  "nav.vouchers": "القسائم",
  "nav.accounts": "الحسابات",
  "nav.stock": "المخزون",
  "nav.sales": "المبيعات",
  "nav.settings": "الإعدادات",
  "nav.logout": "تسجيل الخروج",
  "nav.comingSoon": "قريباً",

  "dashboard.title": "مركز القيادة",
  "dashboard.activeMembers": "الأعضاء النشطين",
  "dashboard.monthlyRevenue": "الإيرادات الشهرية",
  "dashboard.monthlyExpenses": "المصروفات الشهرية",
  "dashboard.todayCheckins": "تسجيلات الدخول اليوم",
  "dashboard.expiringSoon": "ينتهي قريباً",
  "dashboard.lowStock": "مخزون منخفض",
  "dashboard.totalProfit": "إجمالي الربح",
  "dashboard.welcome": "مرحباً بعودتك",

  "staff.title": "إدارة الموظفين",
  "staff.addStaff": "إضافة موظف",
  "staff.table.name": "الاسم",
  "staff.table.email": "البريد الإلكتروني",
  "staff.table.phone": "رقم الهاتف",
  "staff.table.role": "الدور",
  "staff.table.status": "الحالة",
  "staff.table.permissions": "الصلاحيات",
  "staff.table.actions": "إجراءات",
  "staff.edit": "تعديل",
  "staff.delete": "حذف",
  "staff.confirmDelete": "هل أنت متأكد أنك تريد حذف هذا الموظف؟",
  "staff.permissions": "تعديل الصلاحيات",
  "staff.save": "حفظ التغييرات",
  "staff.cancel": "إلغاء",
  
  "settings.title": "إعدادات الصالة الرياضية",
  "settings.gymName": "اسم الصالة الرياضية",
  "settings.phone": "رقم الهاتف",
  "settings.address": "العنوان الفعلي",
  "settings.defaultCurrency": "العملة الافتراضية",
  "settings.usdToCdfRate": "سعر صرف الدولار إلى الفرنك الكونغولي",
  "settings.language": "لغة النظام",
  "settings.receiptHeader": "نص ترويسة الإيصال",
  "settings.receiptFooter": "رسالة تذييل الإيصال",
  "settings.save": "حفظ الإعدادات",
  
  "common.loading": "جاري التحميل...",
  "common.error": "حدث خطأ",
  "common.success": "تمت العملية بنجاح",
  "common.noData": "لا توجد بيانات متاحة",
  "common.comingSoonMsg": "هذه الميزة قيد التطوير حالياً. يرجى التحقق مرة أخرى لاحقاً."
};

const dictionaries: Record<Language, Translations> = { en, fr, ar };

interface I18nStore {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

export const useI18n = create<I18nStore>()(
  persist(
    (set, get) => ({
      language: "en",
      setLanguage: (lang: Language) => set({ language: lang }),
      t: (key: string) => {
        const lang = get().language;
        return dictionaries[lang][key] || key;
      },
    }),
    { name: "gympro-i18n" }
  )
);

export function useI18nDirection() {
  const { language } = useI18n();
  
  useEffect(() => {
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = language;
  }, [language]);
}
