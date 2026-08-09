import { createFileRoute } from "@tanstack/react-router";
import Dashboard from "@/screens/Dashboard";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GramMiner — Mine Gram in Telegram" },
      {
        name: "description",
        content: "Mine Gram, buy miners, finish tasks and invite friends inside the GramMiner Telegram Mini App.",
      },
      { property: "og:title", content: "GramMiner — Mine Gram in Telegram" },
      {
        property: "og:description",
        content: "Mine Gram, buy miners, finish tasks and invite friends inside the GramMiner Telegram Mini App.",
      },
    ],
  }),
  component: Dashboard,
});
