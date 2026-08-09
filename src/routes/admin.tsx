import { createFileRoute } from "@tanstack/react-router";
import Admin from "@/screens/Admin";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GramMiner — Admin" },
      { name: "description", content: "GramMiner admin page inside the Telegram Mini App." },
      { property: "og:title", content: "GramMiner — Admin" },
      { property: "og:description", content: "GramMiner admin page inside the Telegram Mini App." },
    ],
  }),
  component: Admin,
});
