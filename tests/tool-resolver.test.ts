import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl } from "../src/server/runtime/tool-resolver.js";

describe("tool resolver safeguards", () => {
  it("rejects credentials and private or restricted HTTP targets", async () => {
    await expect(
      assertPublicHttpUrl("https://user:pass@example.com"),
    ).rejects.toThrow("Credentials in URLs are not allowed");
    await expect(assertPublicHttpUrl("http://127.0.0.1:8080")).rejects.toThrow(
      "private or restricted",
    );
    await expect(assertPublicHttpUrl("http://169.254.169.254")).rejects.toThrow(
      "private or restricted",
    );
  });
});
