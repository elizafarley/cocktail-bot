"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ViamConnection } from "./lib/viamClient";
import { getBottles, getInventory, getRecipes, updateRecipes } from "./lib/viamClient";
import type { Pour, Recipe } from "./lib/recipes";
import { COMMON_RECIPE_SECTIONS, COMMON_RECIPE_TAGS, DRINK_IMAGE_SLUGS } from "./lib/recipes";
import type { Inventory } from "./lib/inventory";
import { isAvailable } from "./lib/inventory";
import { Nav } from "./nav";
import { titleCase as cap } from "./lib/display";
import styles from "./recipes.module.css";

const DEFAULT_SECTION = "Other";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function fmtOz(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

type SectionGroup = {
  section: string;
  items: { recipe: Recipe; index: number }[];
};

function orderOf(recipe: Recipe): number {
  return recipe.sort_order ?? Number.POSITIVE_INFINITY;
}

function groupRecipesBySection(recipes: Recipe[]): SectionGroup[] {
  const groups = new Map<string, { recipe: Recipe; index: number }[]>();
  recipes.forEach((recipe, index) => {
    const section = recipe.section?.trim() || DEFAULT_SECTION;
    const list = groups.get(section) ?? [];
    list.push({ recipe, index });
    groups.set(section, list);
  });
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const oa = orderOf(a.recipe);
      const ob = orderOf(b.recipe);
      if (oa !== ob) return oa - ob;
      return a.recipe.name.localeCompare(b.recipe.name);
    });
  }
  return [...groups.entries()]
    .sort(([aSection, aList], [bSection, bList]) => {
      if (aSection === DEFAULT_SECTION && bSection !== DEFAULT_SECTION) return 1;
      if (bSection === DEFAULT_SECTION && aSection !== DEFAULT_SECTION) return -1;
      const aMin = Math.min(...aList.map((x) => orderOf(x.recipe)));
      const bMin = Math.min(...bList.map((x) => orderOf(x.recipe)));
      if (aMin !== bMin) return aMin - bMin;
      return aSection.localeCompare(bSection);
    })
    .map(([section, items]) => ({ section, items }));
}

type RecipeStatus =
  | { kind: "loading" }
  | { kind: "off_menu" }
  | { kind: "ready" }
  | { kind: "missing"; ingredient: string };

function recipeStatus(recipe: Recipe, inventory: Inventory | null): RecipeStatus {
  if (recipe.on_menu === false) return { kind: "off_menu" };
  if (!inventory) return { kind: "loading" };
  for (const pour of recipe.pours) {
    const stock = inventory.ingredients[pour.ingredient];
    if (!stock || !stock.in_stock) return { kind: "missing", ingredient: pour.ingredient };
  }
  return { kind: "ready" };
}

export function RecipesPage({ conn }: { conn: ViamConnection }) {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [bottles, setBottles] = useState<string[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ index: number | null; recipe: Recipe } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([getRecipes(conn), getBottles(conn), getInventory(conn)])
      .then(([r, b, inv]) => {
        setRecipes(r);
        setBottles(b);
        setInventory(inv);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [conn]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(next: Recipe[]) {
    setBusy(true);
    setError(null);
    try {
      await updateRecipes(conn, next);
      setRecipes(next);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onSaveEditing(recipe: Recipe) {
    if (!recipes || !editing) return;
    const next = [...recipes];
    if (editing.index === null) {
      next.push(recipe);
    } else {
      next[editing.index] = recipe;
    }
    save(next);
  }

  function onDelete(index: number) {
    if (!recipes) return;
    save(recipes.filter((_, i) => i !== index));
  }

  const ingredientNames = bottles;

  const sections = useMemo(() => groupRecipesBySection(recipes ?? []), [recipes]);
  const readyCount = useMemo(() => {
    if (!recipes || !inventory) return 0;
    return recipes.filter((r) => isAvailable(r, inventory)).length;
  }, [recipes, inventory]);

  return (
    <>
      <Nav current="recipes" />
      <div className={styles.scope}>
        <main className={styles.page}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarTitle}>
              <h1 className={styles.pageTitle}>Recipes</h1>
              {recipes && (
                <p className={styles.toolbarMeta}>
                  {recipes.length} recipe{recipes.length === 1 ? "" : "s"}
                  {inventory ? ` · ${readyCount} ready to make` : ""}
                </p>
              )}
            </div>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnMain}`}
              onClick={() => setEditing({ index: null, recipe: { id: "", name: "", pours: [], on_menu: true } })}
            >
              New recipe
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          {!recipes ? (
            <p className={styles.empty}>Loading…</p>
          ) : recipes.length === 0 ? (
            <p className={styles.empty}>No recipes yet.</p>
          ) : (
            sections.map(({ section, items }) => (
              <section key={section} className={styles.recipeSection} aria-label={section}>
                <h2 className={styles.recipeSectionTitle}>{section}</h2>
                <div className={styles.recipeGrid}>
                  {items.map(({ recipe, index }) => (
                    <RecipeCard
                      key={recipe.id || index}
                      recipe={recipe}
                      status={recipeStatus(recipe, inventory)}
                      onClick={() => setEditing({ index, recipe: structuredClone(recipe) })}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </main>
      </div>

      {editing && (
        <RecipeEditor
          initial={editing.recipe}
          existingIndex={editing.index}
          ingredientNames={ingredientNames}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={onSaveEditing}
          onDelete={() => {
            if (editing.index === null) return;
            if (confirm(`Delete "${editing.recipe.name || editing.recipe.id}"?`)) onDelete(editing.index);
          }}
        />
      )}
    </>
  );
}

function RecipeArt({ slug, name }: { slug?: string; name: string }) {
  if (!slug) return <div className={styles.recipeArt} aria-hidden />;
  return (
    <div className={styles.recipeArt}>
      <picture>
        <source srcSet={`/drinks/png/dark/${slug}.png`} media="(prefers-color-scheme: dark)" />
        <img src={`/drinks/png/light/${slug}.png`} alt="" width={74} height={74} aria-label={name} />
      </picture>
    </div>
  );
}

function RecipeCard({
  recipe,
  status,
  onClick,
}: {
  recipe: Recipe;
  status: RecipeStatus;
  onClick: () => void;
}) {
  const pours = recipe.pours
    .map((p) => `${fmtOz(p.oz)} oz ${cap(p.ingredient)}`)
    .join(" · ");
  return (
    <button type="button" className={styles.recipeCard} onClick={onClick}>
      <RecipeArt slug={recipe.image} name={recipe.name || recipe.id} />
      <span className={styles.recipeBody}>
        <span className={styles.recipeNameRow}>
          <span className={styles.recipeName}>{recipe.name || recipe.id || "(unnamed)"}</span>
          {recipe.tag && <span className={styles.tagBadge}>{recipe.tag}</span>}
        </span>
        <span className={styles.recipePours}>{pours || "No pours"}</span>
        <RecipeStatusLine status={status} />
      </span>
      <span className={styles.recipeChev} aria-hidden>
        ›
      </span>
    </button>
  );
}

function RecipeStatusLine({ status }: { status: RecipeStatus }) {
  if (status.kind === "off_menu") {
    return (
      <span className={`${styles.recipeStatus} ${styles.recipeStatusMuted}`}>
        <span className={styles.statusDot} style={{ background: "var(--smoke)" }} aria-hidden />
        Off the menu
      </span>
    );
  }
  if (status.kind === "loading") {
    return (
      <span className={`${styles.recipeStatus} ${styles.recipeStatusMuted}`}>
        <span className={styles.statusDot} style={{ background: "var(--smoke)" }} aria-hidden />
        On the menu
      </span>
    );
  }
  if (status.kind === "ready") {
    return (
      <span className={styles.recipeStatus}>
        <span className={styles.statusDot} style={{ background: "var(--ok)" }} aria-hidden />
        On the menu · ready to make
      </span>
    );
  }
  return (
    <span className={`${styles.recipeStatus} ${styles.recipeStatusWarn}`}>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 3l9.5 17h-19z" />
        <path d="M12 10v4" />
        <path d="M12 17.5v.5" />
      </svg>
      On the menu · can&rsquo;t make: {cap(status.ingredient)} not on the rack
    </span>
  );
}

function RecipeEditor({
  initial,
  existingIndex,
  ingredientNames,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Recipe;
  existingIndex: number | null;
  ingredientNames: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (recipe: Recipe) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [id, setId] = useState(initial.id);
  const [idTouched, setIdTouched] = useState(initial.id !== "");
  const [onMenu, setOnMenu] = useState(initial.on_menu !== false);
  const [image, setImage] = useState(initial.image ?? "");
  const [section, setSection] = useState(initial.section ?? "");
  const [tag, setTag] = useState(initial.tag ?? "");
  const [sortOrder, setSortOrder] = useState<string>(
    initial.sort_order != null ? String(initial.sort_order) : "",
  );
  const [pours, setPours] = useState<Pour[]>(
    initial.pours.length > 0 ? initial.pours : [{ ingredient: ingredientNames[0] ?? "", oz: 1 }],
  );

  function updatePour(i: number, patch: Partial<Pour>) {
    setPours((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function removePour(i: number) {
    setPours((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addPour() {
    setPours((prev) => [...prev, { ingredient: ingredientNames[0] ?? "", oz: 1 }]);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const effectiveId = (idTouched ? id.trim() : slugify(trimmedName)) || slugify(trimmedName);
    if (!trimmedName) {
      alert("Recipe name is required");
      return;
    }
    if (!effectiveId) {
      alert("Recipe id is required");
      return;
    }
    const next: Recipe = { id: effectiveId, name: trimmedName, pours, on_menu: onMenu };
    if (image) next.image = image;
    const trimmedSection = section.trim();
    if (trimmedSection) next.section = trimmedSection;
    const trimmedTag = tag.trim();
    if (trimmedTag) next.tag = trimmedTag;
    const parsedOrder = Number(sortOrder);
    if (sortOrder !== "" && Number.isFinite(parsedOrder)) next.sort_order = parsedOrder;
    onSave(next);
  }

  return (
    <div className={styles.scope}>
      <div className={styles.scrim} onClick={onClose} />
      <form className={styles.panel} onSubmit={onSubmit}>
        <div className={styles.panelHead}>
          <div>
            <h4>{initial.id ? "Edit recipe" : "New recipe"}</h4>
            <div className={styles.muted}>Recipe</div>
          </div>
          <button type="button" className={styles.closeX} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className={styles.form}>
          <label>
            <span>Name</span>
            <input
              className={styles.input}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Espresso martini"
              required
            />
          </label>

          <label>
            <span>ID</span>
            <input
              className={styles.input}
              type="text"
              value={idTouched ? id : slugify(name)}
              onChange={(e) => {
                setIdTouched(true);
                setId(e.target.value);
              }}
              placeholder="espresso_martini"
            />
          </label>

          <div className={styles.switchRow}>
            <span>On the menu</span>
            <button
              type="button"
              role="switch"
              aria-checked={onMenu}
              className={styles.switch}
              onClick={() => setOnMenu((v) => !v)}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>

          <label>
            <span>Illustration</span>
            <select className={styles.select} value={image} onChange={(e) => setImage(e.target.value)}>
              <option value="">None (grey tile)</option>
              {DRINK_IMAGE_SLUGS.map((slug) => (
                <option key={slug} value={slug}>
                  {cap(slug)}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Section</span>
            <input
              className={styles.input}
              type="text"
              list="recipe-sections"
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="e.g. Classics"
            />
            <datalist id="recipe-sections">
              {COMMON_RECIPE_SECTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>

          <label>
            <span>Tag</span>
            <input
              className={styles.input}
              type="text"
              list="recipe-tags"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="None"
            />
            <datalist id="recipe-tags">
              {COMMON_RECIPE_TAGS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>

          <label>
            <span>Sort order <span className={styles.muted}>(lower shows first)</span></span>
            <input
              className={styles.input}
              type="number"
              step={1}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              placeholder="0"
            />
          </label>

          <p className={styles.sub}>Pours, in order</p>

          <div className={styles.pourHead}>
            <span>Ingredient</span>
            <span>Target (oz)</span>
            <span />
          </div>

          {pours.map((pour, i) => (
            <div key={i} className={styles.pour}>
              {ingredientNames.length > 0 ? (
                <select
                  className={styles.select}
                  value={pour.ingredient}
                  onChange={(e) => updatePour(i, { ingredient: e.target.value })}
                >
                  {!ingredientNames.includes(pour.ingredient) && pour.ingredient !== "" && (
                    <option value={pour.ingredient}>{pour.ingredient} (unknown)</option>
                  )}
                  {pour.ingredient === "" && <option value="">Pick…</option>}
                  {ingredientNames.map((n) => (
                    <option key={n} value={n}>
                      {cap(n)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={styles.input}
                  type="text"
                  value={pour.ingredient}
                  onChange={(e) => updatePour(i, { ingredient: e.target.value })}
                  placeholder="ingredient"
                />
              )}
              <input
                className={styles.input}
                type="number"
                min={0}
                step={0.25}
                value={pour.oz}
                onChange={(e) => updatePour(i, { oz: Math.max(0, Number(e.target.value)) })}
              />
              <button
                type="button"
                className={styles.rm}
                onClick={() => removePour(i)}
                disabled={pours.length === 1}
                aria-label={`Remove pour ${i + 1}`}
              >
                ✕
              </button>
            </div>
          ))}

          <button type="button" className={styles.btn} onClick={addPour}>
            Add a pour
          </button>
        </div>

        <div className={styles.dlgBtns}>
          {existingIndex !== null && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={onDelete}
              disabled={busy}
              style={{ marginRight: "auto" }}
            >
              Delete
            </button>
          )}
          <button type="button" className={styles.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.btn} ${styles.btnMain}`} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
