import { useI18n } from "@/lib/i18n";
import { useClerk, useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function Topbar() {
  const { t, language, setLanguage } = useI18n();
  const { signOut } = useClerk();
  const { user } = useUser();

  const handleLogout = () => {
    signOut({ redirectUrl: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" });
  };

  return (
    <header className="h-16 bg-background border-b border-border flex items-center justify-between px-6 sticky top-0 z-10 w-full">
      <div className="flex-1">
        {/* Breadcrumb or title could go here */}
      </div>

      <div className="flex items-center gap-4">
        <Select value={language} onValueChange={(val: any) => setLanguage(val)}>
          <SelectTrigger className="w-32 bg-card border-border h-9" data-testid="select-language">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="fr">Français</SelectItem>
            <SelectItem value="ar">العربية</SelectItem>
          </SelectContent>
        </Select>

        <div className="h-8 w-px bg-border" />

        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 rounded-md border border-border">
            <AvatarImage src={user?.imageUrl} />
            <AvatarFallback className="rounded-md">
              {user?.firstName?.charAt(0) || "U"}
            </AvatarFallback>
          </Avatar>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            {t("nav.logout")}
          </Button>
        </div>
      </div>
    </header>
  );
}