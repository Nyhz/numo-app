import { PageSkeleton } from "@/src/components/ui/PageSkeleton";

export default function Loading() {
  return <PageSkeleton kpiCells={3} blocks={["chart", "table", "table"]} />;
}
