"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Accounts, { fetchAccounts, type Account } from "@/components/Accounts";
import AreaChart from "@/components/AreaChart";
import Collapsible from "@/components/Collapsible";
import PricesStamp from "@/components/PricesStamp";
import Sparkline from "@/components/Sparkline";
import { permissionWarnings } from "@/lib/bank";
import { change, inRange, RANGES, thin, type ChartPoint, type RangeId } from "@/lib/chart";
import { gainColor, withSign, euros, price, pctWithSign, percent, prettyDate, units } from "@/lib/format";
import { EMPTY_HISTORY, fetchHistory, type History } from "@/lib/history";
import { language, t } from "@/lib/language";
import { fetchPortfolio, portfolioTotals, type PortfolioRow } from "@/lib/portfolio";
import { supabase } from "@/lib/supabase";

type ViewData = {
  accounts: Account[];
  rows: PortfolioRow[];
  warnings: string[];
  error: string;
  history: History;
};

async function fetchViewData(): Promise<ViewData> {
  const [c, portfolio, banks] = await Promise.all([
    fetchAccounts(),
    fetchPortfolio(),
    supabase.from("bank_connections").select("bank, valid_until").eq("status", "active"),
  ]);
  const history = await fetchHistory(portfolio.rows.map((r) => r.a));
  return {
    accounts: c.accounts,
    rows: portfolio.rows,
    // The bank permission expires every few months: a warning is shown 15 days before
    warnings: permissionWarnings(banks.data ?? [], Date.now(), 15, language()),
    error: c.error || portfolio.error,
    history,
  };
}

const RANGE_KEY = "summary-range";
const OPEN_KEY = "summary-open";

type OpenSections = { investments: boolean; accounts: boolean };

// Which folds are open is remembered on this device
function readOpen(): OpenSections {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
    if (saved && typeof saved === "object") {
      return { investments: saved.investments !== false, accounts: saved.accounts === true };
    }
  } catch {}
  return { investments: true, accounts: false };
}

function readRange(): RangeId {
  try {
    const saved = localStorage.getItem(RANGE_KEY);
    if (RANGES.some((r) => r.id === saved)) return saved as RangeId;
  } catch {}
  return "6m";
}

export default function Summary() {
  const [viewData, setViewData] = useState<ViewData | null>(null);
  const [rangeId, setRangeId] = useState<RangeId>(readRange);
  const [hover, setHover] = useState<ChartPoint | null>(null);
  const [openSections, setOpenSections] = useState<OpenSections>(readOpen);

  function toggleSection(key: keyof OpenSections, isOpen: boolean) {
    const next = { ...openSections, [key]: isOpen };
    setOpenSections(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {}
  }

  const show = useCallback((d: ViewData) => setViewData(d), []);
  const reload = useCallback(() => {
    fetchViewData().then(show);
  }, [show]);

  useEffect(() => {
    fetchViewData().then(show);
  }, [show]);

  function pickRange(id: RangeId) {
    setRangeId(id);
    try {
      localStorage.setItem(RANGE_KEY, id);
    } catch {}
  }

  const history = viewData?.history ?? EMPTY_HISTORY;
  const days = RANGES.find((r) => r.id === rangeId)?.days ?? 0;
  const points = useMemo(() => thin(inRange(history.portfolio, days), 160), [history, days]);

  if (!viewData) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <div className="card h-64 animate-pulse" />
        <div className="card h-40 animate-pulse" />
      </div>
    );
  }

  const { accounts, rows, warnings, error } = viewData;
  const accountsTotal = accounts.reduce((s, c) => s + c.balance, 0);
  const inv = portfolioTotals(rows);
  const total = accountsTotal + inv.value;
  const part = (n: number) => (total > 0 ? percent((n / total) * 100) : "");

  const range = change(points);
  const shown = hover ?? points[points.length - 1] ?? null;

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-down">{error}</p>}
      {warnings.map((a) => (
        <p key={a} className="card p-3 text-sm text-orange-500">
          {a}
        </p>
      ))}

      {/* Hero: net worth and the evolution of the investments */}
      <section className="card rise overflow-hidden pt-5">
        <div className="px-5">
          <p className="text-sm text-muted">{t("Patrimonio total", "Net worth")}</p>
          <p className="text-4xl font-bold tracking-tight">{euros(total)}</p>
          {points.length >= 2 && (
            <p className="mt-1 text-sm">
              <span className={`font-semibold ${gainColor(range.diff)}`}>
                <span>{withSign(range.diff)}</span>
                {range.pct !== null ? ` · ${pctWithSign(range.pct)}` : ""}
              </span>
              <span className="text-muted">
                {" "}
                {t("inversiones en este periodo", "investments in this period")}
              </span>
            </p>
          )}
          <p className="mt-1 h-5 text-xs text-muted">
            {hover && shown ? (
              <>
                {prettyDate(shown.date)} · {t("Inversiones", "Investments")}{" "}
                <span className="font-semibold text-foreground">{euros(shown.value)}</span>
              </>
            ) : (
              ""
            )}
          </p>
        </div>

        <div className="mt-2">
          <AreaChart
            points={points}
            positive={range.diff >= 0}
            onHover={setHover}
            label={t("Evolución de tus inversiones", "Evolution of your investments")}
          />
        </div>

        <PricesStamp className="px-5 pt-1 text-xs" />

        <div className="flex justify-between gap-1 px-4 py-3" role="group">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className="chip flex-1"
              aria-pressed={rangeId === r.id}
              onClick={() => pickRange(r.id)}
            >
              {r.id === "all" ? t("Máx", "Max") : r.text.replace("A", language() === "en" ? "Y" : "A")}
            </button>
          ))}
        </div>
      </section>

      {/* Split between cash and investments */}
      <section className="card rise p-5" style={{ animationDelay: "60ms" }}>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div className="bg-accent" style={{ width: total > 0 ? `${(accountsTotal / total) * 100}%` : 0 }} />
          <div className="bg-up" style={{ width: total > 0 ? `${(inv.value / total) * 100}%` : 0 }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-full bg-accent" />
              {t("Cuentas", "Accounts")}
            </p>
            <p className="font-bold">{euros(accountsTotal)}</p>
            <p className="text-xs text-muted">{part(accountsTotal)}</p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-full bg-up" />
              {t("Inversiones", "Investments")}
            </p>
            <p className="font-bold">{euros(inv.value)}</p>
            <p className="text-xs text-muted">{part(inv.value)}</p>
          </div>
        </div>
      </section>

      {/* Investments: every position with its price per unit and trend; it folds like the banks */}
      <div className="rise" style={{ animationDelay: "120ms" }}>
        <Collapsible
          open={openSections.investments}
          onOpen={(o) => toggleSection("investments", o)}
          title={t("Inversiones", "Investments")}
          summary={
            <span>
              <span className="block font-bold">{euros(inv.value)}</span>
              {rows.length > 0 && (
                <span className={`block text-xs font-semibold ${gainColor(inv.gain)}`}>
                  <span>{withSign(inv.gain)}</span>
                  {inv.pct !== null ? ` · ${pctWithSign(inv.pct)}` : ""}
                </span>
              )}
            </span>
          }
        >
          {rows.length === 0 ? (
            <p className="text-sm text-muted">{t("Todavía no hay inversiones.", "No investments yet.")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((f) => (
                <li key={f.a.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{f.a.name}</p>
                    <p className="truncate text-sm font-semibold">
                      {f.latest ? (
                        <>
                          {price(f.latest.price)}
                          <span className="font-normal text-muted"> {t("/ participación", "/ unit")}</span>
                        </>
                      ) : (
                        <span className="font-normal text-muted">{t("Sin precio", "No price")}</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {f.a.platforms?.name ?? ""}
                      {f.a.platforms ? " · " : ""}
                      {units(f.pos.units)} {t("part.", "units")}
                    </p>
                  </div>
                  <Sparkline points={history.byAsset.get(f.a.id) ?? []} />
                  <div className="w-24 shrink-0 text-right">
                    {f.value !== null && f.gain !== null && (
                      <>
                        <p className="font-bold">{euros(f.value)}</p>
                        <p className={`text-xs font-semibold ${gainColor(f.gain)}`}>
                          {f.pct !== null ? pctWithSign(f.pct) : withSign(f.gain)}
                        </p>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {inv.noPrice > 0 && (
            <p className="text-xs text-muted">
              {t(
                `El total no incluye ${inv.noPrice} activo(s) sin precio.`,
                `The total leaves out ${inv.noPrice} asset(s) with no price.`,
              )}
            </p>
          )}
        </Collapsible>
      </div>

      <div className="rise" style={{ animationDelay: "180ms" }}>
        <Collapsible
          open={openSections.accounts}
          onOpen={(o) => toggleSection("accounts", o)}
          title={t("Bancos y cuentas", "Banks and accounts")}
          summary={<span className="font-bold">{euros(accountsTotal)}</span>}
        >
          <Accounts accounts={accounts} onChange={reload} />
        </Collapsible>
      </div>
    </div>
  );
}
