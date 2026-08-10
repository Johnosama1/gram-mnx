import { createFileRoute } from "@tanstack/react-router";
import GiftScreen from "@/screens/Gift";

export const Route = createFileRoute("/gift")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GRAM MNX — Gifts" },
      { name: "description", content: "GRAM MNX gifts page inside the Telegram Mini App." },
      { property: "og:title", content: "GRAM MNX — Gifts" },
      { property: "og:description", content: "GRAM MNX gifts page inside the Telegram Mini App." },
    ],
  }),
  component: GiftScreen,
});
