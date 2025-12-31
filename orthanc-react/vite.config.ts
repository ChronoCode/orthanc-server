
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5713,          // use YOUR dev port
    strictPort: true,    // fail if the port is taken, so you know it’s really 5713
    proxy: {
      "/orthanc": {
        target: "http://localhost", // nginx at :80
        changeOrigin: true,
      },
      "/ohif": {
        target: "http://localhost", // nginx at :80
        changeOrigin: true,
      },
    },
  },
});
