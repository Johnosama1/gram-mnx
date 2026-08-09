import { createFileRoute } from "@tanstack/react-router";
import Miners from "@/screens/Miners";

export const Route = createFileRoute("/miners")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GramMiner — Miners" },
      { name: "description", content: "GramMiner miners page inside the Telegram Mini App." },
      { property: "og:title", content: "GramMiner — Miners" },
      { property: "og:description", content: "GramMiner miners page inside the Telegram Mini App." },
    ],
  }),
  component: Miners,
});
