export interface Recipe {
  id: string;
  name: string;
  steps?: RecipeStep[];
  on_menu?: boolean;
  image?: string;
  section?: string;
  tag?: string;
  sort_order?: number;
  pours?: Pour[];
  crushed_ice?: boolean;
  shake?: boolean;
  strain?: boolean;
}

export type RecipeStep =
  | { kind: "pour"; target?: PourTarget; ingredient: string; oz: number }
  | { kind: "ice"; type?: IceType; target?: PourTarget }
  | { kind: "mix"; mode?: MixMode }
  | { kind: "strain" };

export type PourTarget = "shaker" | "glass";
export type IceType = "crushed" | "cubed";
export type MixMode = "shake" | "stir";

export const COMMON_RECIPE_SECTIONS = ["Classics", "Halloween specials"];
export const COMMON_RECIPE_TAGS = ["Halloween", "New"];

export const DRINK_IMAGE_SLUGS = [
  "amaretto-sour",
  "aperol-spritz",
  "blood-moon",
  "espresso-martini",
  "gin-and-tonic",
  "lemon-drop",
  "margarita",
  "martini",
  "mocktail",
  "moscow-mule",
  "negroni",
  "old-fashioned",
  "witchs-brew",
] as const;

export interface Pour {
  ingredient: string;
  oz: number;
}

export function stepsFor(recipe: Recipe): RecipeStep[] {
  if (recipe.steps && recipe.steps.length > 0) return recipe.steps;
  const out: RecipeStep[] = [];
  if (recipe.crushed_ice ?? true) {
    out.push({ kind: "ice", type: "crushed", target: "shaker" });
  }
  for (const pour of recipe.pours ?? []) {
    out.push({ kind: "pour", target: "shaker", ingredient: pour.ingredient, oz: pour.oz });
  }
  if (recipe.shake ?? true) {
    out.push({ kind: "mix", mode: "shake" });
  }
  if (recipe.strain ?? true) {
    out.push({ kind: "strain" });
  }
  return out;
}

export function recipePours(recipe: Recipe): { ingredient: string; oz: number; target: PourTarget }[] {
  return stepsFor(recipe)
    .filter((s): s is Extract<RecipeStep, { kind: "pour" }> => s.kind === "pour")
    .map((s) => ({ ingredient: s.ingredient, oz: s.oz, target: s.target ?? "shaker" }));
}

export function recipeIngredients(recipe: Recipe): string[] {
  const seen = new Set<string>();
  for (const pour of recipePours(recipe)) {
    if (pour.ingredient) seen.add(pour.ingredient);
  }
  return [...seen];
}
