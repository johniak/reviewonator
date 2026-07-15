import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
    rollupOptions: {
      output: { assetFileNames: "[name][extname]" },
    },
  },
});
