"use client";

import { useCallback, useEffect, useState } from "react";
import type { ViamConnection } from "./lib/viamClient";
import {
  clearSlotAssignment,
  deleteInventoryItem,
  getInventory,
  updateInventoryItem,
  updatePourerOz,
  updateSlotAssignment,
} from "./lib/viamClient";
import type { Inventory } from "./lib/inventory";
import { Nav } from "./nav";
import { titleCase } from "./lib/display";
import styles from "./inventory.module.css";

export function InventoryPage({ conn }: { conn: ViamConnection }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const load = useCallback(() => {
    getInventory(conn)
      .then(setInventory)
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

  const items = inventory ? Object.entries(inventory.ingredients).sort(([a], [b]) => a.localeCompare(b)) : [];
  const inStock = items.filter(([, s]) => s.in_stock);
  const outOfStock = items.filter(([, s]) => !s.in_stock && s.slot);
  const noSlot = items.filter(([, s]) => !s.slot);
  const slots = inventory?.slots ?? [];
  const ingredientNames = items.map(([name]) => name);
  const selectedSlot = selectedSlotId ? slots.find((s) => s.id === selectedSlotId) ?? null : null;
  const selectedStock =
    inventory && selectedSlot?.ingredient ? inventory.ingredients[selectedSlot.ingredient] : undefined;

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
                  <>
                    <StockSection title="In stock" count={inStock.length} items={inStock} inStock busy={busy} onToggle={toggle} onDelete={remove} onPourerOz={savePourerOz} />
                    <StockSection title="Out of stock" count={outOfStock.length} items={outOfStock} inStock={false} busy={busy} onToggle={toggle} onDelete={remove} onPourerOz={savePourerOz} />
                    <StockSection title="No slot" count={noSlot.length} items={noSlot} inStock={false} busy={busy} onToggle={toggle} onDelete={remove} onPourerOz={savePourerOz} />
                  </>
                )}
              </div>
              {selectedSlot && (
                <SlotPanel
                  slot={selectedSlot}
                  stock={selectedStock}
                  ingredientNames={ingredientNames}
                  busy={busy}
                  onAssign={assignSlot}
                  onPourerOz={savePourerOz}
                  onToggleStock={toggle}
                  onDeleteIngredient={remove}
                  onClose={() => setSelectedSlotId(null)}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function PourerOzInput({
  ingredient,
  initial,
  busy,
  onSave,
}: {
  ingredient: string;
  initial: number | undefined;
  busy: boolean;
  onSave: (ingredient: string, oz: number) => void;
}) {
  const [value, setValue] = useState<string>(initial != null ? String(initial) : "");

  function commit() {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setValue(initial != null ? String(initial) : "");
      return;
    }
    if (n === initial) return;
    onSave(ingredient, n);
  }

  return (
    <input
      type="number"
      className={styles.ozInput}
      value={value}
      min={0}
      step={0.5}
      placeholder="oz"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      disabled={busy}
    />
  );
}

type Slot = { id: string; ingredient?: string };
type IngredientRecord = Record<string, { in_stock: boolean; slot?: string; pourer_oz?: number }>;

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
        <span className={styles.rackSlotLabel}>Slot {letter}</span>
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
  busy,
  onAssign,
  onPourerOz,
  onToggleStock,
  onDeleteIngredient,
  onClose,
}: {
  slot: Slot;
  stock: { in_stock: boolean; pourer_oz?: number } | undefined;
  ingredientNames: string[];
  busy: boolean;
  onAssign: (slot: string, ingredient: string) => void;
  onPourerOz: (ingredient: string, oz: number) => void;
  onToggleStock: (ingredient: string, nextInStock: boolean) => void;
  onDeleteIngredient: (ingredient: string) => void;
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

function StockSection({
  title,
  count,
  items,
  inStock,
  busy,
  onToggle,
  onDelete,
  onPourerOz,
}: {
  title: string;
  count: number;
  items: [string, { in_stock: boolean; slot?: string; pourer_oz?: number }][];
  inStock: boolean;
  busy: boolean;
  onToggle: (name: string, next: boolean) => void;
  onDelete: (name: string) => void;
  onPourerOz: (name: string, oz: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className={styles.section}>
      <h2>
        {title}
        <span className={styles.sectionCount}>{count}</span>
      </h2>
      <div className={styles.rows}>
        {items.map(([name, stock]) => (
          <div key={name} className={`${styles.row} ${styles.rowStock}`}>
            <span
              className={styles.dot}
              style={{ background: inStock ? "var(--ok)" : "var(--smoke)" }}
              aria-hidden
            />
            <span className={styles.name}>{titleCase(name)}</span>
            <span className={styles.slot}>{stock.slot ?? ""}</span>
            <PourerOzInput key={`${name}:${stock.pourer_oz ?? ""}`} ingredient={name} initial={stock.pourer_oz} busy={busy} onSave={onPourerOz} />
            <button
              type="button"
              className={`${styles.btn} ${styles.btnStock}`}
              onClick={() => onToggle(name, !inStock)}
              disabled={busy || !stock.slot}
              title={stock.slot ? "" : "Assign this ingredient to a slot above before marking in stock"}
            >
              Mark {inStock ? "out of stock" : "in stock"}
            </button>
            <button
              type="button"
              className={styles.btnIcon}
              onClick={() => onDelete(name)}
              disabled={busy}
              aria-label={`Delete ${name}`}
              title="Delete"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
