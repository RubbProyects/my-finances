"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MarketDetail, { type Instrument } from "@/components/MarketDetail";
import Sparkline from "@/components/Sparkline";
import type { MarketResult } from "@/lib/market-search";
import type { Quote } from "@/app/api/market/quotes/route";
import { callApi } from "@/lib/api";
import {
  addFavorite,
  fetchFavorites,
  removeFavorite,
  type Favorite,
} from "@/lib/favorites";
import { gainColor, marketPrice, pctWithSign } from "@/lib/format";
import { t } from "@/lib/language";

// The favorites' prices refresh by themselves while this tab is open
const REFRESH_MS = 30_000;

function dailyChange(q: Quote): number | null {
  const prev = q.trend.length >= 2 ? q.trend[q.trend.length - 2] : q.previousClose;
  return q.price !== null && prev ? ((q.price - prev) / prev) * 100 : null;
}

export default function Markets() {
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MarketResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<Instrument | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchFavorites().then((r) => {
      setFavorites(r.favorites);
      if (r.error) setError(r.error);
    });
  }, []);

  // Live prices of the favorites
  const key = useMemo(() => (favorites ?? []).map((f) => `${f.symbol}:${f.source}`).join(","), [favorites]);
  const refreshQuotes = useCallback(() => {
    if (!key) return;
    callApi<{ quotes: Quote[] }>(`/api/market/quotes?items=${encodeURIComponent(key)}`)
      .then((r) => setQuotes(new Map(r.quotes.map((q) => [q.symbol, q]))))
      .catch(() => {});
  }, [key]);
  useEffect(() => {
    refreshQuotes();
    const timer = setInterval(refreshQuotes, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshQuotes]);

  // Search: it waits until typing stops for a moment
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      callApi<{ results: MarketResult[] }>(`/api/market/search?q=${encodeURIComponent(q)}`)
        .then((r) => !cancelled && setResults(r.results))
        .catch((e) => {
          if (cancelled) return;
          setResults([]);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => !cancelled && setSearching(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const isStar = (symbol: string) => (favorites ?? []).some((f) => f.symbol === symbol);

  async function toggleStar(i: Instrument & { currency?: string | null }) {
    setError("");
    if (isStar(i.symbol)) {
      const e = await removeFavorite(i.symbol);
      if (e) return setError(e);
      setFavorites((list) => (list ?? []).filter((f) => f.symbol !== i.symbol));
    } else {
      const e = await addFavorite({
        symbol: i.symbol,
        name: i.name,
        source: i.source,
        currency: i.currency ?? null,
      });
      if (e) return setError(e);
      const r = await fetchFavorites();
      setFavorites(r.favorites);
    }
  }

  if (open) {
    return (
      <MarketDetail
        item={open}
        starred={isStar(open.symbol)}
        onStar={() => toggleStar(open)}
        onBack={() => setOpen(null)}
      />
    );
  }

  const showResults = query.trim().length >= 2;

  return (
    <div className="flex flex-col gap-4">
      <label className="card flex items-center gap-2 px-4 py-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Busca una acción, ETF, fondo o crypto", "Search a stock, ETF, fund or crypto")}
          aria-label={t("Buscar en los mercados", "Search the markets")}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query && (
          <button type="button" onClick={() => { setQuery(""); setResults(null); }} aria-label={t("Borrar", "Clear")} className="text-muted">
            ✕
          </button>
        )}
      </label>

      {error && <p className="px-1 text-sm text-down">{error}</p>}

      {showResults ? (
        <section>
          <h2 className="mb-2 px-1 font-semibold">{t("Resultados", "Results")}</h2>
          {searching && !results ? (
            <div className="card h-24 animate-pulse" />
          ) : (results ?? []).length === 0 ? (
            <p className="card p-4 text-sm text-muted">
              {searching
                ? t("Buscando...", "Searching...")
                : t("Sin resultados. Prueba con el símbolo o el ISIN.", "No results. Try the symbol or the ISIN.")}
            </p>
          ) : (
            <ul className="card divide-y divide-line overflow-hidden">
              {(results ?? []).map((r) => (
                <li key={`${r.source}:${r.symbol}`} className="flex items-center gap-2 pr-3">
                  <button
                    type="button"
                    onClick={() => setOpen({ symbol: r.symbol, name: r.name, source: r.source })}
                    className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.name || r.symbol}</span>
                      <span className="block truncate text-xs text-muted">
                        {r.symbol} · {r.exchange}
                        {r.type ? ` · ${r.type}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {r.price !== null && (
                        <span className="block font-bold">{marketPrice(r.price, r.currency)}</span>
                      )}
                      {r.currency && (
                        <span className="block text-xs text-muted">{r.currency}</span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleStar(r)}
                    aria-pressed={isStar(r.symbol)}
                    aria-label={t("Favorito", "Favorite")}
                    className="p-2 text-xl"
                  >
                    <span className={isStar(r.symbol) ? "text-yellow-500" : "text-muted"}>
                      {isStar(r.symbol) ? "★" : "☆"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section>
          <h2 className="mb-2 px-1 font-semibold">{t("Favoritos", "Favorites")}</h2>
          {favorites === null ? (
            <div className="card h-28 animate-pulse" />
          ) : favorites.length === 0 ? (
            <p className="card p-5 text-sm text-muted">
              {t(
                "Busca cualquier activo y pulsa la ☆ para anclarlo aquí. Solo verás lo que busques o marques.",
                "Search any asset and tap the ☆ to pin it here. You only see what you search for or star.",
              )}
            </p>
          ) : (
            <ul className="card rise divide-y divide-line overflow-hidden">
              {favorites.map((f) => {
                const q = quotes.get(f.symbol);
                const ch = q ? dailyChange(q) : null;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setOpen({ symbol: f.symbol, name: f.name, source: f.source })}
                      className="flex w-full items-center gap-3 p-4 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{f.name}</p>
                        <p className="truncate text-xs text-muted">{f.symbol}</p>
                      </div>
                      <Sparkline
                        points={(q?.trend ?? []).map((value, i) => ({ date: String(i), value }))}
                      />
                      <div className="w-24 shrink-0 text-right">
                        {q?.price != null ? (
                          <>
                            <p className="font-bold">{marketPrice(q.price, q.currency ?? f.currency)}</p>
                            {ch !== null && (
                              <p className={`text-xs font-semibold ${gainColor(ch)}`}>{pctWithSign(ch)}</p>
                            )}
                          </>
                        ) : (
                          <div className="ml-auto h-8 w-16 animate-pulse rounded bg-surface-2" />
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
