import { createFileRoute } from "@tanstack/react-router";
import FAQ from "@/screens/FAQ";

export const Route = createFileRoute("/faq")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GRAM MNX — الأسئلة الشائعة" },
      {
        name: "description",
        content: "إجابات على الأسئلة الأكثر شيوعاً حول التعدين والسحب والإيداع والسواب في GRAM MNX.",
      },
      { property: "og:title", content: "GRAM MNX — الأسئلة الشائعة" },
      {
        property: "og:description",
        content: "إجابات على الأسئلة الأكثر شيوعاً حول التعدين والسحب والإيداع والسواب في GRAM MNX.",
      },
    ],
  }),
  component: FAQ,
});
