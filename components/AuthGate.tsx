"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { languageButtons } from "@/components/LanguagePicker";
import { DEMO, DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/demo";
import { button, field } from "@/lib/format";
import { language, t } from "@/lib/language";
import { supabase } from "@/lib/supabase";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    // The page language, for the browser and screen readers
    document.documentElement.lang = language();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) setError(t("Correo o contraseña incorrectos", "Wrong email or password"));
    setSigningIn(false);
  }

  // Demo: everyone signs in with the same demo user
  async function tryDemo() {
    setError("");
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
    });
    if (error) {
      setError(
        t(
          "No se ha podido abrir la demo. Prueba otra vez dentro de un rato.",
          "The demo couldn't be opened. Try again in a while.",
        ),
      );
    }
    setSigningIn(false);
  }

  if (loading) {
    // No text: this is also rendered on the server, which doesn't know the chosen language
    return <p className="p-6">⏳</p>;
  }

  if (!session) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-bold">{t("Mi cartera", "My Finances")}</h1>
        {DEMO ? (
          <div className="flex flex-col gap-3">
            <p className="opacity-80">
              {t(
                "Una app para llevar todo tu dinero en un sitio: cuentas, inversiones, gastos, impuestos y proyecciones.",
                "An app to follow all your money in one place: accounts, investments, spending, taxes and projections.",
              )}
            </p>
            <p className="text-sm opacity-70">
              {t(
                "Esta demo tiene datos de mentira: prueba lo que quieras. Cada noche vuelve a empezar.",
                "This demo has fake data: try anything you like. It starts over every night.",
              )}
            </p>
            <button onClick={tryDemo} disabled={signingIn} className={button}>
              {signingIn ? t("Entrando...", "Signing in...") : t("Probar la demo", "Try the demo")}
            </button>
            {error && <p className="text-down">{error}</p>}
          </div>
        ) : (
          <form onSubmit={signIn} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder={t("Correo", "Email")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className={field}
            />
            <input
              type="password"
              placeholder={t("Contraseña", "Password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className={field}
            />
            <button type="submit" disabled={signingIn} className={button}>
              {signingIn ? t("Entrando...", "Signing in...") : t("Entrar", "Sign in")}
            </button>
            {error && <p className="text-down">{error}</p>}
          </form>
        )}
        <div className="mt-6 flex justify-center gap-2 text-sm">{languageButtons()}</div>
      </main>
    );
  }

  return (
    <div>
      {DEMO && (
        <p className="bg-amber-100 px-3 py-1 text-center text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          {t(
            "🧪 Demo con datos de mentira · vuelve a empezar cada noche",
            "🧪 Demo with fake data · it starts over every night",
          )}
        </p>
      )}
      {children}
    </div>
  );
}
