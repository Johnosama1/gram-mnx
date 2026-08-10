import { createFileRoute } from "@tanstack/react-router";
import Gift from "@/screens/Gift";

export const Route = createFileRoute("/gift")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GRAM MNX — Gift" },
      { name: "description", content: "GRAM MNX gift rewards inside the Telegram Mini App." },
      { property: "og:title", content: "GRAM MNX — Gift" },
      { property: "og:description", content: "GRAM MNX gift rewards inside the Telegram Mini App." },
    ],
  }),
  component: Gift,
});
