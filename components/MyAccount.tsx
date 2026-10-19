"use client";

import { useCallback, useEffect, useState } from "react";
import Collapsible from "@/components/Collapsible";
import { t } from "@/lib/language";
import { supabase } from "@/lib/supabase";

// Email of the open session (read from the browser itself, without going online)
async function fetchEmail(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? "";
}

// Settings section with the email and the sign-out button
export default function MyAccount() {
  const [userEmail, setUserEmail] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  const show = useCallback((c: string) => setUserEmail(c), []);

  useEffect(() => {
    fetchEmail().then(show);
  }, [show]);

  async function signOut() {
    if (!confirm(t("¿Cerrar sesión?", "Sign out?"))) return;
    setSigningOut(true);
    // When signing out, AuthGate shows the sign-in screen again
    await supabase.auth.signOut();
  }

  return (
    <Collapsible title={t("👤 Mi cuenta", "👤 My account")}>
      <p className="text-sm opacity-70">{t("Has entrado como", "Signed in as")}</p>
      <p className="break-all font-semibold">{userEmail}</p>
      <button
        onClick={signOut}
        disabled={signingOut}
        className="rounded border border-red-500 p-3 text-base font-semibold text-red-500 disabled:opacity-50"
      >
        {signingOut ? t("Cerrando...", "Signing out...") : t("Cerrar sesión", "Sign out")}
      </button>
    </Collapsible>
  );
}
