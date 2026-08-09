import { createFileRoute } from "@tanstack/react-router";
import Combo from "@/screens/Combo";

export const Route = createFileRoute("/combo")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GramMiner — Combo" },
      { name: "description", content: "GramMiner combo page inside the Telegram Mini App." },
      { property: "og:title", content: "GramMiner — Combo" },
      { property: "og:description", content: "GramMiner combo page inside the Telegram Mini App." },
    ],
  }),
  component: Combo,
});
