import { createFileRoute } from "@tanstack/react-router";
import Tasks from "@/screens/Tasks";

export const Route = createFileRoute("/tasks")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GramMiner — Tasks" },
      { name: "description", content: "GramMiner tasks page inside the Telegram Mini App." },
      { property: "og:title", content: "GramMiner — Tasks" },
      { property: "og:description", content: "GramMiner tasks page inside the Telegram Mini App." },
    ],
  }),
  component: Tasks,
});
