// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SetupNeededForm from "@/components/setup/SetupNeededForm";

const required = ["NEXTAUTH_SECRET", "ARR_HOST", "RADARR_API_KEY"];

describe("SetupNeededForm", () => {
  it("flags the variables the server reported", () => {
    render(<SetupNeededForm required={required} problems={{ ARR_HOST: "invalid", RADARR_API_KEY: "missing" }} />);
    expect(screen.getByText("not valid")).toBeTruthy();
    expect(screen.getByText("missing")).toBeTruthy();
  });

  it("builds the .env block from what is typed", () => {
    render(<SetupNeededForm required={required} problems={{}} />);
    fireEvent.change(screen.getByLabelText(/ARR_HOST/), { target: { value: "http://10.0.0.5" } });
    expect(screen.getByTestId("env-block").textContent).toContain("ARR_HOST=http://10.0.0.5");
  });

  it("rejects an address without a scheme and keeps Copy disabled", () => {
    render(<SetupNeededForm required={required} problems={{}} />);
    fireEvent.change(screen.getByLabelText(/ARR_HOST/), { target: { value: "10.0.0.5" } });
    expect(screen.getByText(/Must start with http/)).toBeTruthy();
    expect((screen.getByText("Copy") as HTMLButtonElement).disabled).toBe(true);
  });

  it("generates a random secret", () => {
    render(<SetupNeededForm required={required} problems={{}} />);
    fireEvent.click(screen.getAllByText("Generate")[0]);
    const v = (screen.getByLabelText(/NEXTAUTH_SECRET/) as HTMLInputElement).value;
    expect(v.length).toBeGreaterThanOrEqual(40);
  });
});
