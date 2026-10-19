"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { languageButtons } from "@/components/LanguagePicker";
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

  if (loading) {
    // No text: this is also rendered on the server, which doesn't know the chosen language
    return <p className="p-6">⏳</p>;
  }

  if (!session) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-bold">{t("Mi cartera", "My Finances")}</h1>
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
          {error && <p className="text-red-500">{error}</p>}
        </form>
        <div className="mt-6 flex justify-center gap-2 text-sm">{languageButtons()}</div>
      </main>
    );
  }

  return <div>{children}</div>;
}
