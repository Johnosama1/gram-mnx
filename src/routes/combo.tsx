import { createFileRoute } from "@tanstack/react-router";
import Combo from "@/screens/Combo";

export const Route = createFileRoute("/combo")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GRAM MNX — Combo" },
      { name: "description", content: "GRAM MNX combo page inside the Telegram Mini App." },
      { property: "og:title", content: "GRAM MNX — Combo" },
      { property: "og:description", content: "GRAM MNX combo page inside the Telegram Mini App." },
    ],
  }),
  component: Combo,
});
