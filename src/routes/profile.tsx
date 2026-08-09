import { createFileRoute } from "@tanstack/react-router";
import Profile from "@/screens/Profile";

export const Route = createFileRoute("/profile")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GRAM MNX — Profile" },
      { name: "description", content: "GRAM MNX profile page inside the Telegram Mini App." },
      { property: "og:title", content: "GRAM MNX — Profile" },
      { property: "og:description", content: "GRAM MNX profile page inside the Telegram Mini App." },
    ],
  }),
  component: Profile,
});
