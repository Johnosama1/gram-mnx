import { createFileRoute } from "@tanstack/react-router";
import Admin from "@/screens/Admin";

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
  component: Admin,
});
