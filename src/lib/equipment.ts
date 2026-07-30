// Marcas de equipos — lista extensible. Empieza con Waters, Jasco, Shimadzu.
export const EQUIPMENT_BRANDS = [
  "Waters",
  "Jasco",
  "Shimadzu",
  "Agilent",
  "Thermo",
  "PerkinElmer",
  "Otra",
] as const;

export type EquipmentBrand = (typeof EQUIPMENT_BRANDS)[number];
