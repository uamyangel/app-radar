declare module "virtual:app-config" {
  export const flags: { low_rating_threshold: number; low_rating_max_rank: number; surge_rank_delta: number };
  export const signals: Record<string, number>;
  export const includeGenres: number[];
}
