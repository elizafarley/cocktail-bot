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
  makeInlineOrder,
} from "./lib/viamClient";
import type { OrderStatus } from "./lib/viamClient";
import type { Recipe, RecipeStep } from "./lib/recipes";
import { recipePours } from "./lib/recipes";
import type { Inventory, WhiskeyProfile } from "./lib/inventory";
import { isAvailable, WHISKEY_TRAITS } from "./lib/inventory";
import { titleCase } from "./lib/display";
import { Nav } from "./nav";
import styles from "./kiosk.module.css";

type OrderState =
  | { kind: "idle" }
  | { kind: "running"; label: string; slug?: string }
  | { kind: "done"; label: string; slug?: string; at: number }
  | { kind: "error"; label: string; slug?: string; message: string };

type WhiskeyEntry = {
  ingredient: string;
  profile: WhiskeyProfile;
};

const WHISKEY_SLUG = "whiskey-neat";
const WHISKEY_SIZE_TASTE_OZ = 0.5;
const WHISKEY_SIZE_POUR_OZ = 1.5;

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
  const [whiskeyConfirming, setWhiskeyConfirming] = useState<WhiskeyEntry | null>(null);
  const [whiskeyPreview, setWhiskeyPreview] = useState<WhiskeyEntry | null>(null);

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
      const label = recipe.name;
      const slug = recipe.image;
      setOrder({ kind: "running", label, slug });
      try {
        await makeCocktail(conn, recipe.id);
        setOrder({ kind: "done", label, slug, at: Date.now() });
      } catch (err) {
        setOrder({
          kind: "error",
          label,
          slug,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [conn],
  );

  const startWhiskeyOrder = useCallback(
    async (
      entry: WhiskeyEntry,
      size: number,
      serve: "neat" | "rocks",
    ) => {
      const label = `${titleCase(entry.ingredient)} · ${size === WHISKEY_SIZE_TASTE_OZ ? "Taste" : "Pour"} · ${serve === "neat" ? "Neat" : "On the rocks"}`;
      const slug = WHISKEY_SLUG;
      const steps: RecipeStep[] = [];
      if (serve === "rocks") {
        steps.push({ kind: "ice", type: "crushed", target: "shaker" });
      }
      steps.push({ kind: "pour", target: "shaker", ingredient: entry.ingredient, oz: size });
      setOrder({ kind: "running", label, slug });
      try {
        await makeInlineOrder(conn, { name: label, steps });
        setOrder({ kind: "done", label, slug, at: Date.now() });
      } catch (err) {
        setOrder({
          kind: "error",
          label,
          slug,
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
  const allWhiskeys: { entry: WhiskeyEntry; available: boolean }[] = inventory
    ? Object.entries(inventory.ingredients)
        .filter(([, stock]) => stock.category === "Whiskey" && stock.whiskey_profile)
        .sort(([aName, aStock], [bName, bStock]) => {
          const as = aStock.slot ?? "";
          const bs = bStock.slot ?? "";
          if (as && bs && as !== bs) return as.localeCompare(bs);
          if (as && !bs) return -1;
          if (!as && bs) return 1;
          return aName.localeCompare(bName);
        })
        .map(([ingredient, stock]) => ({
          entry: { ingredient, profile: stock.whiskey_profile! },
          available: Boolean(stock.slot && stock.in_stock),
        }))
    : [];
  const availableWhiskeys = allWhiskeys.filter((w) => w.available).map((w) => w.entry);
  const pendingWhiskeys = allWhiskeys.filter((w) => !w.available).map((w) => w.entry);

  const menu = loadError ? (
    <p className={styles.sub}>Could not load menu: {loadError}</p>
  ) : !recipes || !inventory ? (
    <p className={styles.loading}>Loading menu…</p>
  ) : recipes.length === 0 && allWhiskeys.length === 0 ? (
    <p className={styles.loading}>No recipes configured.</p>
  ) : visible.length === 0 && allWhiskeys.length === 0 ? (
    <p className={styles.loading}>No drinks on the menu right now.</p>
  ) : (
    <>
      {availableWhiskeys.length > 0 && (
        <WhiskeyBarSection
          whiskeys={availableWhiskeys}
          disabled={order.kind === "running"}
          onPick={(entry) => setWhiskeyConfirming(entry)}
        />
      )}
      <DrinkMenu
        recipes={visible}
        inventory={inventory}
        pendingWhiskeys={pendingWhiskeys}
        disabled={order.kind === "running"}
        onPick={(recipe, orderable) => setConfirming({ recipe, orderable })}
        onPickPendingWhiskey={(entry) => setWhiskeyPreview(entry)}
      />
    </>
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
          <OrderSheet
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

        {whiskeyConfirming && (
          <WhiskeySheet
            entry={whiskeyConfirming}
            onCancel={() => setWhiskeyConfirming(null)}
            onOrder={(size, serve) => {
              const picked = whiskeyConfirming;
              setWhiskeyConfirming(null);
              startWhiskeyOrder(picked, size, serve);
            }}
          />
        )}

        {whiskeyPreview && (
          <WhiskeyPreviewSheet
            entry={whiskeyPreview}
            onClose={() => setWhiskeyPreview(null)}
          />
        )}

        {order.kind === "error" && (
          <OrderError label={order.label} message={order.message} onDismiss={dismissError} />
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
    text = `Making ${order.label}`;
  } else if (order.kind === "done") {
    dotColor = "var(--ok)";
    text = `${order.label} is ready`;
  } else if (order.kind === "error") {
    dotColor = "var(--bad)";
    text = `${order.label} needs help`;
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

function DrinkArt({
  slug,
  name,
  compact,
  large,
}: {
  slug?: string;
  name: string;
  compact?: boolean;
  large?: boolean;
}) {
  const className = compact ? styles.artCompact : large ? styles.artLarge : styles.art;
  if (!slug) return <div className={className} aria-hidden />;
  const size = compact ? 48 : large ? 180 : 150;
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
  for (const pour of recipePours(recipe)) {
    const stock = inventory.ingredients[pour.ingredient];
    if (!stock || !stock.in_stock) return pour.ingredient;
  }
  return null;
}

function DrinkMenu({
  recipes,
  inventory,
  pendingWhiskeys,
  disabled,
  onPick,
  onPickPendingWhiskey,
}: {
  recipes: Recipe[];
  inventory: Inventory;
  pendingWhiskeys: WhiskeyEntry[];
  disabled: boolean;
  onPick: (recipe: Recipe, orderable: boolean) => void;
  onPickPendingWhiskey: (entry: WhiskeyEntry) => void;
}) {
  const available: Recipe[] = [];
  const unavailable: Recipe[] = [];
  for (const recipe of recipes) {
    (isAvailable(recipe, inventory) ? available : unavailable).push(recipe);
  }
  const sections = groupBySection(available);
  unavailable.sort(compareRecipes);
  const hasBackSoon = unavailable.length > 0 || pendingWhiskeys.length > 0;

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
      {hasBackSoon && (
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
            {pendingWhiskeys.map((entry) => (
              <button
                key={entry.ingredient}
                type="button"
                className={styles.backSoonPill}
                onClick={() => onPickPendingWhiskey(entry)}
                disabled={disabled}
              >
                <DrinkArt slug={WHISKEY_SLUG} name={titleCase(entry.ingredient)} compact />
                <span className={styles.backSoonBody}>
                  <span className={styles.backSoonName}>{titleCase(entry.ingredient)}</span>
                  <span className={styles.backSoonReason}>Whiskey bar · coming soon</span>
                </span>
              </button>
            ))}
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
  const ingredientLine = recipePours(recipe).map((p) => titleCase(p.ingredient)).join(" · ");
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

function OrderSheet({
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
      <div className={`${styles.sheet} ${styles.sheetWide}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetArt}>
          <DrinkArt slug={recipe.image} name={recipe.name} large />
        </div>
        <h3>{recipe.name}</h3>
        <ul className={styles.pours}>
          {recipePours(recipe).map((pour, i) => (
            <li key={i}>
              <span>{titleCase(pour.ingredient)}</span>
              <span>{pour.oz} oz</span>
            </li>
          ))}
        </ul>
        {!orderable && <p className={styles.outNote}>Out of stock</p>}
        <div className={styles.btns}>
          <button type="button" className={`${styles.btn} ${styles.btnBig}`} onClick={onCancel}>
            Back
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnBig} ${styles.btnMain}`}
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
          {order.label} is ready
        </div>
      )}

      {order.kind === "running" ? (
        <div className={styles.rows}>
          <div className={styles.kqRow}>
            <span className={styles.kqName}>{order.label}</span>
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
  label,
  message,
  onDismiss,
}: {
  label: string;
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.scrim}>
      <div className={styles.sheet}>
        <h3 className={styles.err}>{label} failed</h3>
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

function WhiskeyBarSection({
  whiskeys,
  disabled,
  onPick,
}: {
  whiskeys: WhiskeyEntry[];
  disabled: boolean;
  onPick: (entry: WhiskeyEntry) => void;
}) {
  return (
    <section className={styles.menuSection} aria-label="Whiskey bar">
      <h2>Whiskey bar</h2>
      <p className={styles.whiskeyIntro}>Japanese whisky tasting. Start light, finish smoky.</p>
      <ul className={styles.menu}>
        {whiskeys.map((entry) => (
          <li key={entry.ingredient}>
            <WhiskeyCard entry={entry} disabled={disabled} onPick={onPick} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function rarityFromUs(us?: string): string | null {
  if (!us) return null;
  const lower = us.toLowerCase();
  if (lower.startsWith("very unlikely")) return "Very rare";
  if (lower.startsWith("unlikely")) return "Rare";
  return null;
}

function WhiskeyCard({
  entry,
  disabled,
  onPick,
}: {
  entry: WhiskeyEntry;
  disabled: boolean;
  onPick: (entry: WhiskeyEntry) => void;
}) {
  const name = titleCase(entry.ingredient);
  const line = entry.profile.notes || entry.profile.style || "";
  const rarity = rarityFromUs(entry.profile.us);
  return (
    <button
      type="button"
      className={styles.drink}
      onClick={() => onPick(entry)}
      disabled={disabled}
    >
      <DrinkArt slug={WHISKEY_SLUG} name={name} />
      <div className={styles.drinkHead}>
        <h3>{name}</h3>
        <span className={styles.drinkHeadChips}>
          {entry.profile.abv ? (
            <span className={styles.tagBadge}>{entry.profile.abv}%</span>
          ) : null}
          {rarity && <span className={styles.whiskeyRarity}>{rarity}</span>}
        </span>
      </div>
      {line && <p className={styles.ingLine}>{line}</p>}
    </button>
  );
}

function WhiskeySheet({
  entry,
  onCancel,
  onOrder,
}: {
  entry: WhiskeyEntry;
  onCancel: () => void;
  onOrder: (size: number, serve: "neat" | "rocks") => void;
}) {
  const [size, setSize] = useState<number>(WHISKEY_SIZE_TASTE_OZ);
  const [serve, setServe] = useState<"neat" | "rocks">("neat");
  const name = titleCase(entry.ingredient);
  const { abv, region, story, notes, profile, us, style } = entry.profile;
  const hasMeters = profile && profile.length > 0;

  return (
    <div className={styles.scrim} onClick={onCancel}>
      <div className={`${styles.sheet} ${styles.sheetWide}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetArt}>
          <DrinkArt slug={WHISKEY_SLUG} name={name} large />
        </div>
        <h3>{name}</h3>
        {(abv || region || style) && (
          <p className={styles.whiskeySheetMeta}>
            {abv ? `${abv}% · ` : ""}
            {region ?? style ?? ""}
          </p>
        )}
        {story && <p className={styles.whiskeySheetStory}>{story}</p>}
        {notes && (
          <p className={styles.whiskeySheetNotes}>
            <strong>Tasting notes:</strong> {notes}
          </p>
        )}
        {hasMeters && (
          <div className={styles.whiskeySheetMeters} aria-label="Flavor profile">
            {WHISKEY_TRAITS.map((trait, i) => {
              const value = profile![i] ?? 0;
              return (
                <div key={trait} className={styles.whiskeySheetMeter}>
                  <span className={styles.whiskeySheetMeterLabel}>{trait}</span>
                  <span
                    className={styles.whiskeySheetMeterPips}
                    role="img"
                    aria-label={`${trait}: ${value} out of 5`}
                  >
                    {[0, 1, 2, 3, 4].map((n) => (
                      <i
                        key={n}
                        className={n < value ? styles.whiskeySheetPipOn : styles.whiskeySheetPip}
                      />
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {us && <span className={styles.whiskeySheetUs}>{us}</span>}

        <div>
          <span className={styles.whiskeySegLabel} id="lbl-size">Size</span>
          <div className={styles.whiskeySeg} role="group" aria-labelledby="lbl-size">
            <button
              type="button"
              className={size === WHISKEY_SIZE_TASTE_OZ ? `${styles.whiskeySegBtn} ${styles.whiskeySegBtnOn}` : styles.whiskeySegBtn}
              onClick={() => setSize(WHISKEY_SIZE_TASTE_OZ)}
              aria-pressed={size === WHISKEY_SIZE_TASTE_OZ}
            >
              Taste, {WHISKEY_SIZE_TASTE_OZ} oz
            </button>
            <button
              type="button"
              className={size === WHISKEY_SIZE_POUR_OZ ? `${styles.whiskeySegBtn} ${styles.whiskeySegBtnOn}` : styles.whiskeySegBtn}
              onClick={() => setSize(WHISKEY_SIZE_POUR_OZ)}
              aria-pressed={size === WHISKEY_SIZE_POUR_OZ}
            >
              Pour, {WHISKEY_SIZE_POUR_OZ} oz
            </button>
          </div>
        </div>

        <div>
          <span className={styles.whiskeySegLabel} id="lbl-serve">Serve it</span>
          <div className={styles.whiskeySeg} role="group" aria-labelledby="lbl-serve">
            <button
              type="button"
              className={serve === "neat" ? `${styles.whiskeySegBtn} ${styles.whiskeySegBtnOn}` : styles.whiskeySegBtn}
              onClick={() => setServe("neat")}
              aria-pressed={serve === "neat"}
            >
              Neat
            </button>
            <button
              type="button"
              className={serve === "rocks" ? `${styles.whiskeySegBtn} ${styles.whiskeySegBtnOn}` : styles.whiskeySegBtn}
              onClick={() => setServe("rocks")}
              aria-pressed={serve === "rocks"}
            >
              On the rocks
            </button>
          </div>
        </div>

        <div className={styles.btns}>
          <button type="button" className={`${styles.btn} ${styles.btnBig}`} onClick={onCancel}>
            Back
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnBig} ${styles.btnMain}`}
            onClick={() => onOrder(size, serve)}
          >
            Order
          </button>
        </div>
      </div>
    </div>
  );
}

function WhiskeyPreviewSheet({
  entry,
  onClose,
}: {
  entry: WhiskeyEntry;
  onClose: () => void;
}) {
  const name = titleCase(entry.ingredient);
  const { abv, region, story, notes, profile, us, style } = entry.profile;
  const hasMeters = profile && profile.length > 0;

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={`${styles.sheet} ${styles.sheetWide}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetArt}>
          <DrinkArt slug={WHISKEY_SLUG} name={name} large />
        </div>
        <h3>{name}</h3>
        <p className={styles.whiskeyPreviewTag}>Coming soon · tap when it&rsquo;s on the bar</p>
        {(abv || region || style) && (
          <p className={styles.whiskeySheetMeta}>
            {abv ? `${abv}% · ` : ""}
            {region ?? style ?? ""}
          </p>
        )}
        {story && <p className={styles.whiskeySheetStory}>{story}</p>}
        {notes && (
          <p className={styles.whiskeySheetNotes}>
            <strong>Tasting notes:</strong> {notes}
          </p>
        )}
        {hasMeters && (
          <div className={styles.whiskeySheetMeters} aria-label="Flavor profile">
            {WHISKEY_TRAITS.map((trait, i) => {
              const value = profile![i] ?? 0;
              return (
                <div key={trait} className={styles.whiskeySheetMeter}>
                  <span className={styles.whiskeySheetMeterLabel}>{trait}</span>
                  <span
                    className={styles.whiskeySheetMeterPips}
                    role="img"
                    aria-label={`${trait}: ${value} out of 5`}
                  >
                    {[0, 1, 2, 3, 4].map((n) => (
                      <i
                        key={n}
                        className={n < value ? styles.whiskeySheetPipOn : styles.whiskeySheetPip}
                      />
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {us && <span className={styles.whiskeySheetUs}>{us}</span>}
        <div className={styles.btns}>
          <button type="button" className={`${styles.btn} ${styles.btnBig}`} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
