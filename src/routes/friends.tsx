import { createFileRoute } from "@tanstack/react-router";
import Friends from "@/screens/Friends";

export const Route = createFileRoute("/friends")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GramMiner — Friends" },
      { name: "description", content: "GramMiner friends page inside the Telegram Mini App." },
      { property: "og:title", content: "GramMiner — Friends" },
      { property: "og:description", content: "GramMiner friends page inside the Telegram Mini App." },
    ],
  }),
  component: Friends,
});
