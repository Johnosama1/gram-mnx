import { createFileRoute } from "@tanstack/react-router";
import Profile from "@/screens/Profile";

export const Route = createFileRoute("/profile")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GramMiner — Profile" },
      { name: "description", content: "GramMiner profile page inside the Telegram Mini App." },
      { property: "og:title", content: "GramMiner — Profile" },
      { property: "og:description", content: "GramMiner profile page inside the Telegram Mini App." },
    ],
  }),
  component: Profile,
});
