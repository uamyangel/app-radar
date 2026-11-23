import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { parse } from "yaml";
import { defineConfig, type Plugin } from "vite";

/** 构建时读取仓库根目录的 config.yaml，只把前端需要的阈值和品类白名单暴露为 virtual:app-config */
function appConfig(): Plugin {
  const file = resolve(__dirname, "../../config.yaml");
  const id = "virtual:app-config";
  return {
    name: "app-config",
    resolveId: (s) => (s === id ? "\0" + id : undefined),
    load(s) {
      if (s !== "\0" + id) return;
      this.addWatchFile(file);
      const cfg = parse(readFileSync(file, "utf8"));
      const flags = cfg.flags;
      for (const k of ["low_rating_threshold", "low_rating_max_rank", "surge_rank_delta"]) {
        if (typeof flags?.[k] !== "number") throw new Error(`config.yaml 缺少 flags.${k}`);
      }
      const signals = cfg.insights?.signals;
      const includeGenres = cfg.insights?.include_genres;
      if (!signals || !Array.isArray(includeGenres)) throw new Error("config.yaml 缺少 insights.signals 或 insights.include_genres");
      return `export const flags = ${JSON.stringify(flags)};
export const signals = ${JSON.stringify(signals)};
export const includeGenres = ${JSON.stringify(includeGenres)};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), appConfig()],
  server: { proxy: { "/api": "http://localhost:8788" } },
});
