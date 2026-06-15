import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, Dumbbell } from "lucide-react";

export default function LoginPage() {
  const { t } = useI18n();
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
    fetch(`${apiBase}/api/auth/setup`)
      .then(r => r.json())
      .then(d => { if (d.needsSetup) setLocation("/setup"); })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
      setLocation("/dashboard");
    } catch (err: any) {
      setError(err.message ?? t("auth.loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex bg-background">
      {/* Left brand panel — hidden on small screens */}
      <div className="hidden lg:flex lg:w-[44%] flex-col justify-between p-10 bg-[hsl(224,44%,9%)] relative overflow-hidden">
        {/* Background subtle pattern */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 25% 25%, white 1px, transparent 1px),
              radial-gradient(circle at 75% 75%, white 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />
        {/* Gradient glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-primary/20 blur-3xl pointer-events-none" />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center shadow-lg">
            <img
              src="/gym-logo.jpg"
              alt="Oxygen Fitness Gym"
              className="h-10 w-10 rounded-xl object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">OXYGEN GYM</span>
        </div>

        {/* Main tagline */}
        <div className="relative space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/20 border border-primary/30">
            <Dumbbell className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary">GymPro Management</span>
          </div>
          <h2 className="text-3xl font-bold text-white leading-tight">
            Run your gym<br />
            <span className="text-primary">smarter</span>, not harder.
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed max-w-xs">
            Members, staff, payments, stock — everything in one clean dashboard built for gym operators.
          </p>
        </div>

        {/* Bottom credit */}
        <p className="relative text-xs text-slate-600">
          OxygenGym &copy; {new Date().getFullYear()}
        </p>
      </div>

      {/* Right sign-in panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          {/* Mobile-only logo */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            <div className="h-14 w-14 rounded-2xl overflow-hidden shadow-lg mb-3">
              <img
                src="/gym-logo.jpg"
                alt="Oxygen Fitness Gym"
                className="h-14 w-14 object-cover"
                onError={(e) => {
                  const el = e.target as HTMLImageElement;
                  el.style.display = "none";
                  el.parentElement!.classList.add("bg-primary", "flex", "items-center", "justify-center");
                }}
              />
            </div>
            <span className="font-bold text-lg tracking-tight">OXYGEN GYM</span>
          </div>

          {/* Heading */}
          <div className="mb-7">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">{t("auth.welcomeBack")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("auth.signInToContinue")}</p>
          </div>

          {/* Form card */}
          <form
            onSubmit={handleSubmit}
            className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm space-y-5"
          >
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-sm font-medium">
                {t("auth.username")}
              </Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t("auth.usernamePlaceholder")}
                disabled={loading}
                required
                autoFocus
                className="h-10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">
                {t("auth.password")}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  required
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute inset-y-0 end-0 px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-10 font-semibold"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  {t("auth.signingIn")}
                </>
              ) : (
                t("auth.signIn")
              )}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground/60 mt-6">
            OxygenGym &copy; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}
