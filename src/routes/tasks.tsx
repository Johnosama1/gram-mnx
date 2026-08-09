import { createFileRoute } from "@tanstack/react-router";
import Tasks from "@/screens/Tasks";

export const Route = createFileRoute("/tasks")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GRAM MNX — Tasks" },
      { name: "description", content: "GRAM MNX tasks page inside the Telegram Mini App." },
      { property: "og:title", content: "GRAM MNX — Tasks" },
      { property: "og:description", content: "GRAM MNX tasks page inside the Telegram Mini App." },
    ],
  }),
  component: Tasks,
});
