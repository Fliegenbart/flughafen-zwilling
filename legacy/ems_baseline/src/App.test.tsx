import { render, screen } from "@testing-library/react";
import App from "./App";

describe("HMI smoke", () => {
  it("renders the HMI dashboard without crashing", () => {
    render(<App />);
    expect(screen.getByText(/HiL TESTING LAB/i)).toBeInTheDocument();
  });
});
