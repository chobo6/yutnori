import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AdminPage } from "./components/AdminPage";

const isAdmin = window.location.pathname === "/admin";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isAdmin ? <AdminPage /> : <App />}</StrictMode>,
);
