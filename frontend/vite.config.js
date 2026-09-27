import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "BACKEND_");
  const backendUrl = env.BACKEND_URL || "http://localhost:8080";

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": backendUrl,
      },
    },
  };
});
