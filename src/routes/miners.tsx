import { createFileRoute } from "@tanstack/react-router";
import Miners from "@/screens/Miners";

export const Route = createFileRoute("/miners")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GRAM MNX — Miners" },
      { name: "description", content: "GRAM MNX miners page inside the Telegram Mini App." },
      { property: "og:title", content: "GRAM MNX — Miners" },
      { property: "og:description", content: "GRAM MNX miners page inside the Telegram Mini App." },
    ],
  }),
  component: Miners,
});
