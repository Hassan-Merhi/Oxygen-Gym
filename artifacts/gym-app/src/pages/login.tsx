import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Dumbbell, Loader2 } from "lucide-react";

export default function LoginPage() {
  const { t } = useI18n();
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-redirect to setup if no admin has a password yet
  useEffect(() => {
    fetch("/api/auth/setup")
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
    <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md">
        {/* Logo + Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg mb-4">
            <Dumbbell className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">GymPro</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t("auth.tagline")}</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-8">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-1">{t("auth.welcomeBack")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{t("auth.signInToContinue")}</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-slate-700 dark:text-slate-300 font-medium">
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
              <Label htmlFor="password" className="text-slate-700 dark:text-slate-300 font-medium">
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
                  className="absolute inset-y-0 end-0 px-3 flex items-center text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white font-medium" disabled={loading}>
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
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          GymPro &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
