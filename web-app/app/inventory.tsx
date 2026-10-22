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
            <>
              {slots.length > 0 && (
                <SlotsSection slots={slots} ingredientNames={ingredientNames} busy={busy} onAssign={assignSlot} />
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
            </>
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

function SlotsSection({
  slots,
  ingredientNames,
  busy,
  onAssign,
}: {
  slots: { id: string; ingredient?: string }[];
  ingredientNames: string[];
  busy: boolean;
  onAssign: (slot: string, ingredient: string) => void;
}) {
  return (
    <section className={styles.section}>
      <h2>
        Slots
        <span className={styles.sectionCount}>{slots.length}</span>
      </h2>
      <div className={styles.rows}>
        {slots.map((slot) => (
          <div key={slot.id} className={`${styles.row} ${styles.rowSlot}`}>
            <span className={styles.dot} style={{ background: slot.ingredient ? "var(--ok)" : "var(--smoke)" }} aria-hidden />
            <span className={styles.name}>{slot.id}</span>
            <select
              className={styles.select}
              value={slot.ingredient ?? ""}
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
          </div>
        ))}
      </div>
    </section>
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
