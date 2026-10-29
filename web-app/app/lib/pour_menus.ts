export interface PourMenu {
  id: string;
  name: string;
  category: string;
  intro?: string;
  on_menu?: boolean;
  illustration?: string;
  sizes: PourSize[];
  default_size?: string;
  serves: PourServe[];
  traits?: string[];
  sort_order?: number;
}

export interface PourSize {
  label: string;
  oz: number;
}

export interface PourServe {
  label: string;
  glass?: string;
  with_ice?: boolean;
  staff_step?: string;
}

export function slugifyMenuId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
