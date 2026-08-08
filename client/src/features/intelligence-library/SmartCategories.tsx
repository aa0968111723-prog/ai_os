import { Button } from "../../components/ui";
import type { DataHubResource } from "@shared/dataHub";

export type SmartCategoryId = "all" | "people" | "scenes" | "images" | "videos" | "audio" | "documents" | "scripts" | "projects" | "more";

const CATEGORIES: Array<{ id: SmartCategoryId; label: string }> = [
  { id: "all", label: "全部" },
  { id: "people", label: "人物" },
  { id: "scenes", label: "場景" },
  { id: "images", label: "圖片" },
  { id: "videos", label: "影片" },
  { id: "audio", label: "音訊" },
  { id: "documents", label: "文件" },
  { id: "scripts", label: "腳本" },
  { id: "projects", label: "專案" },
  { id: "more", label: "更多" },
];

export function resourceMatchesSmartCategory(resource: DataHubResource, category: SmartCategoryId): boolean {
  if (category === "all" || category === "more") return true;
  const intelligence = resource.intelligence;
  const canonical = intelligence?.canonicalType;
  const tags = intelligence?.tags ?? [];
  if (category === "images") return canonical === "IMAGE" || (canonical == null && resource.kind === "asset");
  if (category === "videos") return canonical === "VIDEO";
  if (category === "audio") return canonical === "AUDIO";
  if (category === "documents") return resource.kind === "document" || resource.kind === "knowledge"
    || ["DOCUMENT", "PRESENTATION", "SPREADSHEET", "TEXT"].includes(canonical ?? "");
  if (category === "scripts") return /script|腳本|劇本/i.test(intelligence?.category ?? "") || tags.includes("usage:storyboard-reference");
  if (category === "scenes") return tags.some((tag) => tag.startsWith("scene:") || tag.startsWith("location:"))
    || /scene|場景/i.test(intelligence?.category ?? "");
  if (category === "projects") return !!resource.projectId;
  return false;
}

export function SmartCategories({ value, onChange }: { value: SmartCategoryId; onChange: (value: SmartCategoryId) => void }) {
  return (
    <div className="smart-categories" role="group" aria-label="智慧分類">
      {CATEGORIES.map((category) => (
        <Button
          key={category.id}
          size="sm"
          variant={value === category.id ? "primary" : undefined}
          aria-pressed={value === category.id}
          onClick={() => onChange(category.id)}
        >
          {category.label}
        </Button>
      ))}
    </div>
  );
}
