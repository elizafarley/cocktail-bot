"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ViamConnection } from "./lib/viamClient";
import {
  clearSlotAssignment,
  deleteInventoryItem,
  getInventory,
  getRecipes,
  updateCategory,
  updateInventoryItem,
  updatePourerOz,
  updateSlotAssignment,
} from "./lib/viamClient";
import type { Inventory } from "./lib/inventory";
import type { Recipe } from "./lib/recipes";
import { recipeIngredients } from "./lib/recipes";
import { Nav } from "./nav";
import { titleCase } from "./lib/display";
import styles from "./inventory.module.css";

const COMMON_CATEGORIES = ["Spirits", "Liqueurs", "Juices & mixers", "Syrups & bitters"];
const UNCATEGORIZED = "Uncategorized";

export function InventoryPage({ conn }: { conn: ViamConnection }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedIngredient, setSelectedIngredient] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("All");

  const load = useCallback(() => {
    Promise.all([getInventory(conn), getRecipes(conn)])
      .then(([inv, rs]) => {
        setInventory(inv);
        setRecipes(rs);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [conn]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(ingredient: string, inStock: boolean) {
    setBusy(true);
    setError(null);
    try {
      await updateInventoryItem(conn, ingredient, inStock);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(ingredient: string) {
    if (!confirm(`Delete "${titleCase(ingredient)}" from inventory?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteInventoryItem(conn, ingredient);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addIngredient() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await updateInventoryItem(conn, name, true);
      setNewName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePourerOz(ingredient: string, oz: number) {
    setBusy(true);
    setError(null);
    try {
      await updatePourerOz(conn, ingredient, oz);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function assignSlot(slot: string, ingredient: string) {
    setBusy(true);
    setError(null);
    try {
      if (ingredient === "") {
        await clearSlotAssignment(conn, slot);
      } else {
        await updateSlotAssignment(conn, slot, ingredient);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory(ingredient: string, category: string) {
    setBusy(true);
    setError(null);
    try {
      await updateCategory(conn, ingredient, category);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const usedIn = useMemo(() => buildRecipeIndex(recipes), [recipes]);

  const items = inventory ? Object.entries(inventory.ingredients).sort(([a], [b]) => a.localeCompare(b)) : [];
  const slots = inventory?.slots ?? [];
  const ingredientNames = items.map(([name]) => name);
  const selectedSlot = selectedSlotId ? slots.find((s) => s.id === selectedSlotId) ?? null : null;
  const selectedStock =
    inventory && selectedSlot?.ingredient ? inventory.ingredients[selectedSlot.ingredient] : undefined;
  const activeIngredient = selectedIngredient && inventory?.ingredients[selectedIngredient] ? selectedIngredient : null;
  const activeIngredientStock = activeIngredient ? inventory!.ingredients[activeIngredient] : undefined;

  function pickIngredient(name: string) {
    const stock = inventory?.ingredients[name];
    if (stock?.slot) {
      setSelectedSlotId((prev) => (prev === stock.slot ? null : stock.slot!));
      setSelectedIngredient(null);
    } else {
      setSelectedSlotId(null);
      setSelectedIngredient((prev) => (prev === name ? null : name));
    }
  }

  return (
    <>
      <Nav current="inventory" />
      <div className={styles.scope}>
        <main className={styles.page}>
          <div className={styles.toolbar}>
            <h1 className={styles.pageTitle}>Inventory</h1>
            <div className={styles.addRow}>
              <input
                type="text"
                className={styles.input}
                placeholder="New ingredient"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addIngredient();
                }}
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnMain}`}
                onClick={addIngredient}
                disabled={busy || !newName.trim()}
              >
                Add
              </button>
            </div>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          {!inventory ? (
            <p className={styles.empty}>Loading…</p>
          ) : (
            <div className={styles.layout}>
              <div className={styles.layoutLeft}>
                {slots.length > 0 && (
                  <RackSection
                    slots={slots}
                    ingredients={inventory.ingredients}
                    selectedId={selectedSlotId}
                    onSelect={(id) => setSelectedSlotId((prev) => (prev === id ? null : id))}
                  />
                )}
                {items.length === 0 ? (
                  <p className={styles.empty}>No ingredients yet. Add one above.</p>
                ) : (
                  <AllIngredientsSection
                    items={items}
                    usedIn={usedIn}
                    filter={filter}
                    onFilter={setFilter}
                    selectedName={activeIngredient ?? (selectedSlot?.ingredient ?? null)}
                    onPick={pickIngredient}
                  />
                )}
              </div>
              {selectedSlot ? (
                <SlotPanel
                  slot={selectedSlot}
                  stock={selectedStock}
                  ingredientNames={ingredientNames}
                  usedIn={selectedSlot.ingredient ? usedIn.get(selectedSlot.ingredient) ?? [] : []}
                  busy={busy}
                  onAssign={assignSlot}
                  onPourerOz={savePourerOz}
                  onToggleStock={toggle}
                  onDeleteIngredient={remove}
                  onCategory={saveCategory}
                  onClose={() => setSelectedSlotId(null)}
                />
              ) : activeIngredient ? (
                <IngredientPanel
                  name={activeIngredient}
                  stock={activeIngredientStock}
                  usedIn={usedIn.get(activeIngredient) ?? []}
                  busy={busy}
                  onCategory={saveCategory}
                  onDeleteIngredient={remove}
                  onClose={() => setSelectedIngredient(null)}
                />
              ) : (
                <aside className={`${styles.panel} ${styles.panelEmpty}`} aria-hidden>
                  <div className={styles.panelHead}>
                    <div>
                      <p className={styles.panelCrumb}>Side panel</p>
                      <h2 className={styles.panelTitle}>Pick a slot</h2>
                    </div>
                  </div>
                  <div className={styles.panelBody}>
                    <p className={styles.panelHint}>
                      Tap any card above to change its bottle, set the pourer size, or mark it out of stock.
                    </p>
                  </div>
                </aside>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}

type Slot = { id: string; ingredient?: string };
type IngredientRecord = Record<string, { in_stock: boolean; slot?: string; pourer_oz?: number; category?: string }>;
type IngredientEntry = [string, { in_stock: boolean; slot?: string; pourer_oz?: number; category?: string }];

function buildRecipeIndex(recipes: Recipe[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const recipe of recipes) {
    for (const ingredient of recipeIngredients(recipe)) {
      const list = out.get(ingredient) ?? [];
      list.push(recipe.name);
      out.set(ingredient, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.localeCompare(b));
  return out;
}

function categoryOf(stock: { category?: string }): string {
  return stock.category && stock.category.trim() ? stock.category : UNCATEGORIZED;
}

function parseSlotId(id: string): { letter: string; row: string } {
  const parts = id.split("-");
  const letter = (parts[1] ?? "").toUpperCase();
  const row = parts.slice(2).join(" ");
  return { letter, row };
}

const POURER_SIZES = [0.5, 1, 1.5] as const;

function RackSection({
  slots,
  ingredients,
  selectedId,
  onSelect,
}: {
  slots: Slot[];
  ingredients: IngredientRecord;
  selectedId: string | null;
  onSelect: (slotId: string) => void;
}) {
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const { row } = parseSlotId(slot.id);
    const key = row || "other";
    const list = groups.get(key) ?? [];
    list.push(slot);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  return (
    <section className={styles.section}>
      <h2>
        On the rack
        <span className={styles.sectionCount}>{slots.length}</span>
      </h2>
      {[...groups.entries()].map(([row, rowSlots]) => (
        <div key={row} className={styles.rackGroup}>
          <h3 className={styles.rowLabel}>{titleCase(row)}</h3>
          <div className={styles.rack}>
            {rowSlots.map((slot) => (
              <RackCard
                key={slot.id}
                slot={slot}
                stock={slot.ingredient ? ingredients[slot.ingredient] : undefined}
                selected={selectedId === slot.id}
                onSelect={() => onSelect(slot.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function RackCard({
  slot,
  stock,
  selected,
  onSelect,
}: {
  slot: Slot;
  stock: { in_stock: boolean; pourer_oz?: number } | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const { letter } = parseSlotId(slot.id);
  const hasBottle = Boolean(slot.ingredient);
  const inStock = hasBottle && stock?.in_stock;
  const statusLabel = !hasBottle ? "Empty" : inStock ? "In stock" : "Out of stock";
  const dotColor = !hasBottle ? "var(--smoke)" : inStock ? "var(--ok)" : "var(--bad)";

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`${styles.rackCard} ${selected ? styles.rackCardSelected : ""}`}
      onClick={onSelect}
    >
      <span className={styles.rackHead}>
        <span className={styles.rackLetter}>{letter}</span>
      </span>
      <span className={styles.rackBottle}>{hasBottle ? titleCase(slot.ingredient!) : "Empty slot"}</span>
      {hasBottle && stock?.pourer_oz != null && (
        <span className={styles.rackPourer}>{stock.pourer_oz} oz pourer</span>
      )}
      <span className={styles.rackStatus}>
        <span className={styles.dot} style={{ background: dotColor }} aria-hidden />
        {statusLabel}
      </span>
    </button>
  );
}

function SlotPanel({
  slot,
  stock,
  ingredientNames,
  usedIn,
  busy,
  onAssign,
  onPourerOz,
  onToggleStock,
  onDeleteIngredient,
  onCategory,
  onClose,
}: {
  slot: Slot;
  stock: { in_stock: boolean; pourer_oz?: number; category?: string } | undefined;
  ingredientNames: string[];
  usedIn: string[];
  busy: boolean;
  onAssign: (slot: string, ingredient: string) => void;
  onPourerOz: (ingredient: string, oz: number) => void;
  onToggleStock: (ingredient: string, nextInStock: boolean) => void;
  onDeleteIngredient: (ingredient: string) => void;
  onCategory: (ingredient: string, category: string) => void;
  onClose: () => void;
}) {
  const { letter, row } = parseSlotId(slot.id);
  const bottle = slot.ingredient;
  const hasBottle = Boolean(bottle);
  const inStock = Boolean(hasBottle && stock?.in_stock);
  const pourerOz = stock?.pourer_oz;

  return (
    <aside className={styles.panel} aria-label={`Slot ${letter}`}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelCrumb}>
            Slot {letter}
            {row ? ` · ${titleCase(row)}` : ""}
          </p>
          <h2 className={styles.panelTitle}>{hasBottle ? titleCase(bottle!) : "Empty slot"}</h2>
          {hasBottle && (
            <p className={styles.panelStatus}>
              <span
                className={styles.dot}
                style={{ background: inStock ? "var(--ok)" : "var(--bad)" }}
                aria-hidden
              />
              {inStock ? "In stock" : "Out of stock"}
            </p>
          )}
        </div>
        <button type="button" className={styles.panelClose} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className={styles.panelBody}>
      <label className={styles.panelField}>
        <span className={styles.panelLabel}>Bottle in this slot</span>
        <select
          className={styles.select}
          value={bottle ?? ""}
          onChange={(e) => onAssign(slot.id, e.target.value)}
          disabled={busy}
        >
          <option value="">— empty —</option>
          {ingredientNames.map((n) => (
            <option key={n} value={n}>
              {titleCase(n)}
            </option>
          ))}
        </select>
      </label>

      {hasBottle && (
        <CategoryField
          ingredient={bottle!}
          initial={stock?.category ?? ""}
          busy={busy}
          onSave={onCategory}
        />
      )}

      {hasBottle && usedIn.length > 0 && (
        <div className={styles.panelField}>
          <span className={styles.panelLabel}>Used in</span>
          <div className={styles.usedChips}>
            {usedIn.map((name) => (
              <span key={name} className={styles.usedChip}>
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {hasBottle && (
        <fieldset className={styles.panelField}>
          <legend className={styles.panelLabel}>Pourer</legend>
          <div className={styles.segmented}>
            {POURER_SIZES.map((oz) => {
              const active = pourerOz === oz;
              return (
                <button
                  key={oz}
                  type="button"
                  aria-pressed={active}
                  className={`${styles.segment} ${active ? styles.segmentActive : ""}`}
                  onClick={() => onPourerOz(bottle!, oz)}
                  disabled={busy}
                >
                  {oz} oz
                </button>
              );
            })}
          </div>
          {pourerOz != null && !POURER_SIZES.includes(pourerOz as typeof POURER_SIZES[number]) && (
            <p className={styles.panelHint}>Currently set to {pourerOz} oz.</p>
          )}
        </fieldset>
      )}
      </div>

      {hasBottle && (
        <div className={styles.panelActions}>
          <button
            type="button"
            className={styles.panelBtn}
            onClick={() => onToggleStock(bottle!, !inStock)}
            disabled={busy}
          >
            Mark {inStock ? "out of stock" : "in stock"}
          </button>
          <button
            type="button"
            className={styles.panelBtnGhost}
            onClick={() => onAssign(slot.id, "")}
            disabled={busy}
          >
            Clear slot
          </button>
          <button
            type="button"
            className={styles.panelBtnDanger}
            onClick={() => onDeleteIngredient(bottle!)}
            disabled={busy}
          >
            Delete ingredient…
          </button>
        </div>
      )}
    </aside>
  );
}

function IngredientPanel({
  name,
  stock,
  usedIn,
  busy,
  onCategory,
  onDeleteIngredient,
  onClose,
}: {
  name: string;
  stock: { in_stock: boolean; pourer_oz?: number; category?: string } | undefined;
  usedIn: string[];
  busy: boolean;
  onCategory: (ingredient: string, category: string) => void;
  onDeleteIngredient: (ingredient: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className={styles.panel} aria-label={name}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelCrumb}>Not on rack</p>
          <h2 className={styles.panelTitle}>{titleCase(name)}</h2>
          <p className={styles.panelHint}>Assign a slot above before you can mark this in stock.</p>
        </div>
        <button type="button" className={styles.panelClose} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className={styles.panelBody}>
        <CategoryField ingredient={name} initial={stock?.category ?? ""} busy={busy} onSave={onCategory} />

        {usedIn.length > 0 && (
          <div className={styles.panelField}>
            <span className={styles.panelLabel}>Used in</span>
            <div className={styles.usedChips}>
              {usedIn.map((recipeName) => (
                <span key={recipeName} className={styles.usedChip}>
                  {recipeName}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={styles.panelActions}>
        <button
          type="button"
          className={styles.panelBtnDanger}
          onClick={() => onDeleteIngredient(name)}
          disabled={busy}
        >
          Delete ingredient…
        </button>
      </div>
    </aside>
  );
}

function CategoryField({
  ingredient,
  initial,
  busy,
  onSave,
}: {
  ingredient: string;
  initial: string;
  busy: boolean;
  onSave: (ingredient: string, category: string) => void;
}) {
  const options =
    initial && !COMMON_CATEGORIES.includes(initial) ? [initial, ...COMMON_CATEGORIES] : COMMON_CATEGORIES;
  return (
    <label className={styles.panelField}>
      <span className={styles.panelLabel}>Category</span>
      <select
        className={styles.select}
        value={initial}
        onChange={(e) => {
          if (e.target.value !== initial) onSave(ingredient, e.target.value);
        }}
        disabled={busy}
      >
        <option value="">— None —</option>
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

function AllIngredientsSection({
  items,
  usedIn,
  filter,
  onFilter,
  selectedName,
  onPick,
}: {
  items: IngredientEntry[];
  usedIn: Map<string, string[]>;
  filter: string;
  onFilter: (next: string) => void;
  selectedName: string | null;
  onPick: (name: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const [, stock] of items) {
    const cat = categoryOf(stock);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const activeCategories = [...counts.keys()].sort((a, b) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b);
  });

  const filteredItems = filter === "All" ? items : items.filter(([, s]) => categoryOf(s) === filter);
  const grouped = new Map<string, IngredientEntry[]>();
  for (const entry of filteredItems) {
    const cat = categoryOf(entry[1]);
    const list = grouped.get(cat) ?? [];
    list.push(entry);
    grouped.set(cat, list);
  }
  const orderedCats = [...grouped.keys()].sort((a, b) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b);
  });

  return (
    <section className={styles.section}>
      <div className={styles.sectionBar}>
        <h2>All ingredients</h2>
        <div className={styles.chips}>
          <FilterChip label="All" count={items.length} active={filter === "All"} onClick={() => onFilter("All")} />
          {activeCategories.map((cat) => (
            <FilterChip
              key={cat}
              label={cat}
              count={counts.get(cat) ?? 0}
              active={filter === cat}
              onClick={() => onFilter(cat)}
            />
          ))}
        </div>
      </div>

      <div className={styles.tableHead}>
        <span>Ingredient</span>
        <span>Status</span>
        <span>Pourer</span>
        <span>Used in</span>
      </div>

      {orderedCats.map((cat) => (
        <div key={cat} className={styles.catGroup}>
          <h3 className={styles.rowLabel}>{cat}</h3>
          {(grouped.get(cat) ?? []).map(([name, stock]) => (
            <IngredientRow
              key={name}
              name={name}
              stock={stock}
              recipeNames={usedIn.get(name) ?? []}
              selected={selectedName === name}
              onPick={onPick}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`${styles.chip} ${active ? styles.chipActive : ""}`}
      onClick={onClick}
    >
      {label} <span className={styles.chipCount}>{count}</span>
    </button>
  );
}

function IngredientRow({
  name,
  stock,
  recipeNames,
  selected,
  onPick,
}: {
  name: string;
  stock: { in_stock: boolean; slot?: string; pourer_oz?: number };
  recipeNames: string[];
  selected: boolean;
  onPick: (name: string) => void;
}) {
  let dotColor = "transparent";
  let statusLabel: string;
  if (!stock.slot) {
    statusLabel = "Not on rack";
    dotColor = "var(--smoke)";
  } else if (stock.in_stock) {
    statusLabel = `On rack · Slot ${parseSlotId(stock.slot).letter}`;
    dotColor = "var(--ok)";
  } else {
    statusLabel = "Out of stock";
    dotColor = "var(--bad)";
  }
  return (
    <div
      className={`${styles.tableRow} ${selected ? styles.tableRowSelected : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onPick(name)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(name);
        }
      }}
    >
      <span className={styles.rowName}>{titleCase(name)}</span>
      <span className={styles.rowStatus}>
        <span
          className={styles.dot}
          style={{ background: stock.slot ? dotColor : "transparent", border: stock.slot ? "0" : "1.5px solid var(--smoke)" }}
          aria-hidden
        />
        {statusLabel}
      </span>
      <span className={styles.rowPourer}>{stock.pourer_oz != null ? `${stock.pourer_oz} oz` : "—"}</span>
      <span className={styles.rowUsed}>{recipeNames.length > 0 ? recipeNames.join(", ") : "—"}</span>
    </div>
  );
}

