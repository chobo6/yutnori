import { useState } from "react";
import { AdminLogin } from "./AdminLogin";
import { AdminDashboard } from "./AdminDashboard";
import { AdminUsers } from "./AdminUsers";
import { AdminInquiries } from "./AdminInquiries";

export function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [view, setView] = useState<"dashboard" | "users" | "inquiries">("dashboard");

  function handleUnauthorized() {
    setLoggedIn(false);
    setView("dashboard");
  }

  if (!loggedIn) {
    return <AdminLogin onSuccess={() => setLoggedIn(true)} />;
  }

  if (view === "users") {
    return <AdminUsers onUnauthorized={handleUnauthorized} onBack={() => setView("dashboard")} />;
  }

  if (view === "inquiries") {
    return <AdminInquiries onUnauthorized={handleUnauthorized} onBack={() => setView("dashboard")} />;
  }

  return (
    <AdminDashboard
      onUnauthorized={handleUnauthorized}
      onOpenUsers={() => setView("users")}
      onOpenInquiries={() => setView("inquiries")}
    />
  );
}
