import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VoiceAgentProvider } from "@/contexts/VoiceAgentContext";
import { SquareProvider } from "@/contexts/SquareContext";
import { OrderProvider } from "@/contexts/OrderContext";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VoiceAgentProvider>
      <SquareProvider>
        <OrderProvider>
          <App />
        </OrderProvider>
      </SquareProvider>
    </VoiceAgentProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
    });
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    }).catch(() => {});

    if ("caches" in window) {
      window.caches.keys().then((keys) => {
        keys.forEach((key) => {
          void window.caches.delete(key);
        });
      }).catch(() => {});
    }
  }
}
