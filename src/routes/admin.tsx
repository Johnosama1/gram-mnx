import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import Admin from "@/screens/Admin";
import AdminGate from "@/components/AdminGate";

function AdminPage() {
  const [unlocked, setUnlocked] = useState(false);
  const onUnlock = useCallback(() => setUnlocked(true), []);
  if (!unlocked) return <AdminGate onUnlock={onUnlock} />;
  return <Admin />;
}


export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GRAM MNX — Admin" },
      { name: "description", content: "GRAM MNX admin page inside the Telegram Mini App." },
      { property: "og:title", content: "GRAM MNX — Admin" },
      { property: "og:description", content: "GRAM MNX admin page inside the Telegram Mini App." },
    ],
  }),
  component: AdminPage,
});
