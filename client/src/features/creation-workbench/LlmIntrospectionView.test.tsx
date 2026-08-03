import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LlmIntrospectionView } from "./LlmIntrospectionView";

describe("LlmIntrospectionView", () => {
  it("shows the confidence the model reported and the least certain fragments", () => {
    render(<LlmIntrospectionView introspection={{
      meanConfidence: 0.82,
      lowestConfidence: [{ token: "療效", probability: 0.1 }],
    }} />);
    expect(screen.getByText("平均 82%")).toBeInTheDocument();
    expect(screen.getByText(/療效/)).toHaveTextContent("10%");
  });

  it("always labels disclosed reasoning as the provider's text, not the model's real thinking", () => {
    render(<LlmIntrospectionView introspection={{ disclosedReasoning: "供應商給的推理摘要" }} />);
    expect(screen.getByText("供應商回傳的推理摘要")).toBeInTheDocument();
    expect(screen.getByTestId("disclosed-reasoning")).toHaveTextContent("供應商給的推理摘要");
    expect(screen.getByText(/不等於模型真實的內部思考/)).toBeInTheDocument();
  });

  it("says so when the model cannot report confidence at all", () => {
    render(<LlmIntrospectionView introspection={{ logprobsUnsupported: true }} />);
    expect(screen.getByText(/不提供逐 token 信心值/)).toBeInTheDocument();
  });

  it("renders nothing when the provider disclosed nothing", () => {
    const { container } = render(<LlmIntrospectionView introspection={{}} />);
    expect(container).toBeEmptyDOMElement();
    const { container: none } = render(<LlmIntrospectionView />);
    expect(none).toBeEmptyDOMElement();
  });
});
