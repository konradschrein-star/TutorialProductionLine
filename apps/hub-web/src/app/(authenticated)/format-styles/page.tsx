import { listFormatStyleLibraries } from "@/lib/repositories/format-style-library-repository";
import { FormatStyleListClient } from "@/components/format-styles/format-style-list-client";

export const metadata = {
  title: "Format Style Libraries",
  description: "Manage visual style references for content formats",
};

export default async function FormatStylesPage() {
  const libraries = await listFormatStyleLibraries({ is_active: true });
  return <FormatStyleListClient libraries={libraries} />;
}
