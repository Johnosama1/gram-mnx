import { createFileRoute } from "@tanstack/react-router";
import Friends from "@/screens/Friends";

export const Route = createFileRoute("/friends")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GRAM MNX — Friends" },
      { name: "description", content: "GRAM MNX friends page inside the Telegram Mini App." },
      { property: "og:title", content: "GRAM MNX — Friends" },
      { property: "og:description", content: "GRAM MNX friends page inside the Telegram Mini App." },
    ],
  }),
  component: Friends,
});
