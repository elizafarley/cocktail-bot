"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ViamConnection } from "./lib/viamClient";
import {
  getInventory,
  getRecipes,
  getMachineName,
  getStatus,
  makeCocktail,
} from "./lib/viamClient";
import type { OrderStatus } from "./lib/viamClient";
import type { Recipe } from "./lib/recipes";
import type { Inventory } from "./lib/inventory";
import { isAvailable } from "./lib/inventory";
import { titleCase } from "./lib/display";
import { Nav } from "./nav";
import styles from "./kiosk.module.css";

type OrderState =
  | { kind: "idle" }
  | { kind: "running"; recipe: Recipe }
  | { kind: "done"; recipe: Recipe; at: number }
  | { kind: "error"; recipe: Recipe; message: string };

const READY_CARD_MS = 60_000;
const MINUTES_PER_DRINK = 3;

export function Kiosk({ conn, connected }: { conn: ViamConnection; connected: boolean }) {
  const params = useSearchParams();
  const kioskMode = params.get("kiosk") === "1";
  const [machineName, setMachineName] = useState<string>("");
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderState>({ kind: "idle" });
  const [confirming, setConfirming] = useState<{ recipe: Recipe; orderable: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMachineName(conn)
      .then((n) => !cancelled && setMachineName(n))
      .catch(() => {});
    Promise.all([getRecipes(conn), getInventory(conn)])
      .then(([r, i]) => {
        if (cancelled) return;
        setRecipes(r);
        setInventory(i);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [conn]);

  const startOrder = useCallback(
    async (recipe: Recipe) => {
      setOrder({ kind: "running", recipe });
      try {
        await makeCocktail(conn, recipe.id);
        setOrder({ kind: "done", recipe, at: Date.now() });
      } catch (err) {
        setOrder({
          kind: "error",
          recipe,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [conn],
  );

  const dismissError = useCallback(() => setOrder({ kind: "idle" }), []);

  // Auto-fade the "ready" state after READY_CARD_MS so the sidebar returns to idle.
  useEffect(() => {
    if (order.kind !== "done") return;
    const remaining = Math.max(0, READY_CARD_MS - (Date.now() - order.at));
    const t = window.setTimeout(() => setOrder({ kind: "idle" }), remaining);
    return () => window.clearTimeout(t);
  }, [order]);

  const visible = recipes ? recipes.filter((r) => r.on_menu !== false) : [];

  const menu = loadError ? (
    <p className={styles.sub}>Could not load menu: {loadError}</p>
  ) : !recipes || !inventory ? (
    <p className={styles.loading}>Loading menu…</p>
  ) : recipes.length === 0 ? (
    <p className={styles.loading}>No recipes configured.</p>
  ) : visible.length === 0 ? (
    <p className={styles.loading}>No drinks on the menu right now.</p>
  ) : (
    <DrinkMenu
      recipes={visible}
      inventory={inventory}
      disabled={order.kind === "running"}
      onPick={(recipe, orderable) => setConfirming({ recipe, orderable })}
    />
  );

  return (
    <>
      {!kioskMode && <Nav current="kiosk" />}
      <div className={styles.scope}>
        {kioskMode && (
          <header className={styles.kioskHeader}>
            <span className={styles.wordmark}>Cocktail Bot</span>
            <StatusPill order={order} connected={connected} />
          </header>
        )}
        <main className={`${styles.main} ${kioskMode ? styles.mainKiosk : ""}`}>
          <h1 className={styles.title}>What can we make you?</h1>
          <p className={styles.sub}>
            {kioskMode ? "Tap a drink to order." : "Tap a drink to see what’s in it."}
            {!connected && !kioskMode && (
              <span className={styles.warn}>
                {" · reconnecting to "}
                {machineName || conn.hostname}
              </span>
            )}
            {conn.isDev && " · dev mock"}
          </p>

          {kioskMode ? (
            menu
          ) : (
            <div className={styles.kBody}>
              <div className={styles.menuWrap}>{menu}</div>
              <KioskQueue conn={conn} order={order} />
            </div>
          )}
        </main>

        {confirming && (
          <ConfirmOrder
            recipe={confirming.recipe}
            orderable={confirming.orderable}
            onCancel={() => setConfirming(null)}
            onConfirm={() => {
              const picked = confirming.recipe;
              setConfirming(null);
              startOrder(picked);
            }}
          />
        )}

        {order.kind === "error" && (
          <OrderError recipe={order.recipe} message={order.message} onDismiss={dismissError} />
        )}
      </div>
    </>
  );
}

function StatusPill({ order, connected }: { order: OrderState; connected: boolean }) {
  let dotColor = "var(--ok)";
  let text: string;
  if (!connected) {
    dotColor = "var(--bad)";
    text = "Reconnecting…";
  } else if (order.kind === "running") {
    dotColor = "var(--verm)";
    text = `Making ${order.recipe.name}`;
  } else if (order.kind === "done") {
    dotColor = "var(--ok)";
    text = `${order.recipe.name} is ready`;
  } else if (order.kind === "error") {
    dotColor = "var(--bad)";
    text = `${order.recipe.name} needs help`;
  } else {
    text = `Nobody in line · about ${MINUTES_PER_DRINK} min per drink`;
  }
  return (
    <span className={styles.statusPill}>
      <span className={styles.statusDot} style={{ background: dotColor }} aria-hidden />
      {text}
    </span>
  );
}

function DrinkArt({ slug, name, compact }: { slug?: string; name: string; compact?: boolean }) {
  const className = compact ? styles.artCompact : styles.art;
  if (!slug) return <div className={className} aria-hidden />;
  const size = compact ? 48 : 150;
  return (
    <div className={className}>
      <picture>
        <source srcSet={`/drinks/png/dark/${slug}.png`} media="(prefers-color-scheme: dark)" />
        <img src={`/drinks/png/light/${slug}.png`} alt="" width={size} height={size} aria-label={name} />
      </picture>
    </div>
  );
}

const DEFAULT_SECTION = "Menu";

function orderOf(recipe: Recipe): number {
  return recipe.sort_order ?? Number.POSITIVE_INFINITY;
}

function compareRecipes(a: Recipe, b: Recipe): number {
  const oa = orderOf(a);
  const ob = orderOf(b);
  if (oa !== ob) return oa - ob;
  return a.name.localeCompare(b.name);
}

function groupBySection(recipes: Recipe[]): { section: string; recipes: Recipe[] }[] {
  const groups = new Map<string, Recipe[]>();
  for (const recipe of recipes) {
    const section = recipe.section?.trim() || DEFAULT_SECTION;
    const list = groups.get(section) ?? [];
    list.push(recipe);
    groups.set(section, list);
  }
  for (const list of groups.values()) list.sort(compareRecipes);
  const ordered = [...groups.entries()].sort(([aSection, aList], [bSection, bList]) => {
    if (aSection === DEFAULT_SECTION && bSection !== DEFAULT_SECTION) return 1;
    if (bSection === DEFAULT_SECTION && aSection !== DEFAULT_SECTION) return -1;
    const aMin = Math.min(...aList.map(orderOf));
    const bMin = Math.min(...bList.map(orderOf));
    if (aMin !== bMin) return aMin - bMin;
    return aSection.localeCompare(bSection);
  });
  return ordered.map(([section, recipes]) => ({ section, recipes }));
}

function firstMissingIngredient(recipe: Recipe, inventory: Inventory): string | null {
  for (const pour of recipe.pours) {
    const stock = inventory.ingredients[pour.ingredient];
    if (!stock || !stock.in_stock) return pour.ingredient;
  }
  return null;
}

function DrinkMenu({
  recipes,
  inventory,
  disabled,
  onPick,
}: {
  recipes: Recipe[];
  inventory: Inventory;
  disabled: boolean;
  onPick: (recipe: Recipe, orderable: boolean) => void;
}) {
  const available: Recipe[] = [];
  const unavailable: Recipe[] = [];
  for (const recipe of recipes) {
    (isAvailable(recipe, inventory) ? available : unavailable).push(recipe);
  }
  const sections = groupBySection(available);
  unavailable.sort(compareRecipes);

  return (
    <>
      {sections.map(({ section, recipes }) => (
        <section key={section} className={styles.menuSection} aria-label={section}>
          <h2>{section}</h2>
          <ul className={styles.menu}>
            {recipes.map((recipe) => (
              <li key={recipe.id}>
                <DrinkCard recipe={recipe} disabled={disabled} orderable onPick={onPick} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {unavailable.length > 0 && (
        <section className={styles.backSoon} aria-label="Back soon">
          <h2>Back soon</h2>
          <div className={styles.backSoonRow}>
            {unavailable.map((recipe) => {
              const missing = firstMissingIngredient(recipe, inventory);
              return (
                <button
                  key={recipe.id}
                  type="button"
                  className={styles.backSoonPill}
                  onClick={() => onPick(recipe, false)}
                  disabled={disabled}
                >
                  <DrinkArt slug={recipe.image} name={recipe.name} compact />
                  <span className={styles.backSoonBody}>
                    <span className={styles.backSoonName}>{recipe.name}</span>
                    <span className={styles.backSoonReason}>
                      {missing ? `Out of ${titleCase(missing)}` : "Unavailable"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function DrinkCard({
  recipe,
  disabled,
  orderable,
  onPick,
}: {
  recipe: Recipe;
  disabled: boolean;
  orderable: boolean;
  onPick: (recipe: Recipe, orderable: boolean) => void;
}) {
  const ingredientLine = recipe.pours.map((p) => titleCase(p.ingredient)).join(" · ");
  return (
    <button
      type="button"
      className={`${styles.drink} ${!orderable ? styles.out : ""}`}
      onClick={() => onPick(recipe, orderable)}
      disabled={disabled}
    >
      <DrinkArt slug={recipe.image} name={recipe.name} />
      <div className={styles.drinkHead}>
        <h3>{recipe.name}</h3>
        {recipe.tag && <span className={styles.tagBadge}>{recipe.tag}</span>}
      </div>
      {ingredientLine && <p className={styles.ingLine}>{ingredientLine}</p>}
    </button>
  );
}

function ConfirmOrder({
  recipe,
  orderable,
  onCancel,
  onConfirm,
}: {
  recipe: Recipe;
  orderable: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className={styles.scrim} onClick={onCancel}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <h3>{recipe.name}</h3>
        <ul className={styles.pours}>
          {recipe.pours.map((pour, i) => (
            <li key={i}>
              <span>{titleCase(pour.ingredient)}</span>
              <span>{pour.oz} oz</span>
            </li>
          ))}
        </ul>
        {!orderable && <p className={styles.outNote}>Out of stock</p>}
        <div className={styles.btns}>
          <button type="button" className={styles.btn} onClick={onCancel}>
            Back
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnMain}`}
            onClick={onConfirm}
            disabled={!orderable}
          >
            Order
          </button>
        </div>
      </div>
    </div>
  );
}

function KioskQueue({
  conn,
  order,
}: {
  conn: ViamConnection;
  order: OrderState;
}) {
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const pollActive = order.kind === "running";

  useEffect(() => {
    if (!pollActive) return;
    let cancelled = false;
    const poll = () => {
      getStatus(conn)
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [conn, pollActive]);

  const currentPhaseForRunning = pollActive ? status?.current_step : undefined;

  return (
    <aside className={styles.kq} aria-label="Queue">
      <h2>In line</h2>

      {order.kind === "done" && (
        <div className={styles.kqReady} role="status">
          {order.recipe.name} is ready
        </div>
      )}

      {order.kind === "running" ? (
        <div className={styles.rows}>
          <div className={styles.kqRow}>
            <span className={styles.kqName}>{order.recipe.name}</span>
            <span className={styles.kqTag}>Making now</span>
          </div>
          {currentPhaseForRunning && <p className={styles.kqNote}>{currentPhaseForRunning}</p>}
        </div>
      ) : (
        order.kind !== "done" && <p className={styles.kqNote}>Nobody in line.</p>
      )}
    </aside>
  );
}

function OrderError({
  recipe,
  message,
  onDismiss,
}: {
  recipe: Recipe;
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.scrim}>
      <div className={styles.sheet}>
        <h3 className={styles.err}>{recipe.name} failed</h3>
        <p>{message}</p>
        <div className={styles.btns}>
          <button type="button" className={`${styles.btn} ${styles.btnMain}`} onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
