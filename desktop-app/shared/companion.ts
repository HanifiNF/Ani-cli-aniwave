export const COMPANION_PETS = ["columbinya", "endminguga", "feibi"] as const;
export type CompanionPetId = typeof COMPANION_PETS[number];
export const COMPANION_FREQUENCIES = ["quiet", "normal", "chatty"] as const;
export type CompanionFrequency = typeof COMPANION_FREQUENCIES[number];

export interface CompanionPreferences {
  companionEnabled?: boolean;
  companionPetId?: CompanionPetId;
  companionFrequency?: CompanionFrequency;
}

export const COMPANION_DEFAULTS = { companionEnabled: true, companionPetId: "columbinya", companionFrequency: "normal" } as const;

export function normalizeCompanionPreferences(value: CompanionPreferences): Required<CompanionPreferences> {
  return {
    companionEnabled: value.companionEnabled !== false,
    companionPetId: COMPANION_PETS.includes(value.companionPetId as CompanionPetId) ? value.companionPetId! : "columbinya",
    companionFrequency: COMPANION_FREQUENCIES.includes(value.companionFrequency as CompanionFrequency) ? value.companionFrequency! : "normal"
  };
}

export type CompanionAnimation = "idle" | "run-right" | "run-left" | "wave" | "jump" | "failed" | "waiting" | "working" | "review";
export const COMPANION_ANIMATIONS: Record<CompanionAnimation, { row: number; frames: number }> = {
  idle: { row: 0, frames: 6 }, "run-right": { row: 1, frames: 8 }, "run-left": { row: 2, frames: 8 },
  wave: { row: 3, frames: 4 }, jump: { row: 4, frames: 5 }, failed: { row: 5, frames: 8 },
  waiting: { row: 6, frames: 6 }, working: { row: 7, frames: 6 }, review: { row: 8, frames: 6 }
};

export const COMPANION_REGISTRY: Record<CompanionPetId, { name: string; image: string; columns: number; rows: number; cellWidth: number; cellHeight: number }> = {
  columbinya: { name: "Columbinya", image: "pets/columbinya/spritesheet.webp", columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 },
  endminguga: { name: "GUGUGAGA", image: "pets/endminguga/spritesheet.webp", columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 },
  feibi: { name: "菲比", image: "pets/feibi/spritesheet.webp", columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 }
};

export const companionImageUrl = (id: CompanionPetId, base = "./") => `${base}${COMPANION_REGISTRY[id].image}`;

export function companionFrame(animation: CompanionAnimation, frame: number): { x: number; y: number } {
  const { row, frames } = COMPANION_ANIMATIONS[animation];
  return { x: Math.min(frames - 1, Math.max(0, Math.floor(frame))) * 192, y: row * 208 };
}
