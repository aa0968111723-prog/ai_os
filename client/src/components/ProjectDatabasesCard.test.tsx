import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDatabasesCard } from "./ProjectDatabasesCard";

const linkedToProject = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    databases: {
      linkedToProject: {
        useQuery: (...args: unknown[]) => linkedToProject(...args),
      },
    },
  },
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("ProjectDatabasesCard", () => {
  beforeEach(() => {
    linkedToProject.mockReset();
    linkedToProject.mockReturnValue({ data: [], isLoading: false, error: null });
  });

  it("shows the data entry points even when no linked rows exist", () => {
    render(<ProjectDatabasesCard projectId="project-1" />);

    expect(screen.getByText("加入資料與專案資料表")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /貼上文字/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Google／Notion／API/i })).toHaveAttribute("href", "/integrations");
    expect(screen.getByText(/只有完成帳號連接還不代表已匯入/i)).toBeInTheDocument();
  });
});
