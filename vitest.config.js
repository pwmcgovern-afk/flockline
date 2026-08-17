import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vercel's local build output can contain copies of server files. Exclude
    // it so local checks never discover and rerun stale generated test files.
    exclude: [...configDefaults.exclude, ".vercel/**"]
  }
});
