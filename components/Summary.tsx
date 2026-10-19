"use client";

import { useCallback, useEffect, useState } from "react";
import Accounts, { fetchAccounts, type Account } from "@/components/Accounts";
import Collapsible from "@/components/Collapsible";
import { permissionWarnings } from "@/lib/bank";
import { fetchPortfolio, portfolioTotals, type PortfolioRow } from "@/lib/portfolio";
import { gainColor, withSign, euros, pctWithSign, percent } from "@/lib/format";
import { language, t } from "@/lib/language";
import { supabase } from "@/lib/supabase";

type ViewData = { accounts: Account[]; rows: PortfolioRow[]; warnings: string[]; error: string };

async function fetchViewData(): Promise<ViewData> {
  const [c, portfolio, banks] = await Promise.all([
    fetchAccounts(),
    fetchPortfolio(),
    supabase.from("bank_connections").select("bank, valid_until").eq("status", "active"),
  ]);
  return {
    accounts: c.accounts,
    rows: portfolio.rows,
    // The bank permission expires every few months: a warning is shown 15 days before
    warnings: permissionWarnings(banks.data ?? [], Date.now(), 15, language()),
    error: c.error || portfolio.error,
  };
}

export default function Summary() {
  const [viewData, setViewData] = useState<ViewData | null>(null);

  const show = useCallback((d: ViewData) => setViewData(d), []);
  const reload = useCallback(() => {
    fetchViewData().then(show);
  }, [show]);

  useEffect(() => {
    fetchViewData().then(show);
  }, [show]);

  if (!viewData) return <p>{t("Cargando...", "Loading...")}</p>;

  const { accounts, rows, warnings, error } = viewData;
  const accountsTotal = accounts.reduce((s, c) => s + c.balance, 0);
  const inv = portfolioTotals(rows);
  const total = accountsTotal + inv.value;
  const part = (n: number) => (total > 0 ? percent((n / total) * 100) : "");

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-red-500">{error}</p>}
      {warnings.map((a) => (
        <p key={a} className="rounded border border-orange-500/60 p-2 text-sm text-orange-500">
          {a}
        </p>
      ))}

      <Collapsible
        open
        title={
          <span>
            <span className="block text-sm font-normal opacity-70">
              {t("Patrimonio total", "Net worth")}
            </span>
            <span className="text-2xl font-bold">{euros(total)}</span>
          </span>
        }
      >
        <Collapsible
          nested
          title={t("🏦 Bancos y cuentas", "🏦 Banks and accounts")}
          summary={
            <span>
              <span className="font-bold">{euros(accountsTotal)}</span>
              <span className="block text-xs opacity-60">{part(accountsTotal)}</span>
            </span>
          }
        >
          <Accounts accounts={accounts} onChange={reload} />
        </Collapsible>

        <Collapsible
          nested
          title={t("📈 Inversiones", "📈 Investments")}
          summary={
            <span>
              <span className="font-bold">{euros(inv.value)}</span>
              <span className="block text-xs opacity-60">{part(inv.value)}</span>
            </span>
          }
        >
          {rows.length === 0 ? (
            <p className="text-sm opacity-70">
              {t("Todavía no hay inversiones.", "No investments yet.")}
            </p>
          ) : (
            <>
              <p className={`text-sm font-semibold ${gainColor(inv.gain)}`}>
                {t("Beneficio", "Gain")}: <span>{withSign(inv.gain)}</span>
                {inv.pct !== null ? ` (${pctWithSign(inv.pct)})` : ""}
              </p>
              <ul className="flex flex-col gap-2">
                {rows.map((f) => (
                  <li
                    key={f.a.id}
                    className="flex items-center justify-between gap-3 rounded border border-gray-400/50 p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{f.a.name}</p>
                      <p className="text-sm opacity-70">{f.a.platforms?.name ?? ""}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {f.value !== null && f.gain !== null ? (
                        <>
                          <p className="font-bold">{euros(f.value)}</p>
                          <p className={`text-sm ${gainColor(f.gain)}`}>
                            {f.pct !== null ? pctWithSign(f.pct) : withSign(f.gain)}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm opacity-70">{t("Sin precio", "No price")}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {inv.noPrice > 0 && (
                <p className="text-xs opacity-70">
                  {t(
                    `El total no incluye ${inv.noPrice} activo(s) sin precio.`,
                    `The total leaves out ${inv.noPrice} asset(s) with no price.`,
                  )}
                </p>
              )}
            </>
          )}
        </Collapsible>
      </Collapsible>
    </div>
  );
}
