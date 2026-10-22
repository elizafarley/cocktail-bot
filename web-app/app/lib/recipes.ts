export interface Recipe {
  id: string;
  name: string;
  pours: Pour[];
  on_menu?: boolean;
  image?: string;
}

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

export function recipeIngredients(recipe: Recipe): string[] {
  const seen = new Set<string>();
  for (const pour of recipe.pours) {
    if (pour.ingredient) seen.add(pour.ingredient);
  }
  return [...seen];
}
