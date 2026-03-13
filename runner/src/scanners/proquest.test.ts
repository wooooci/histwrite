import { describe, expect, it } from "vitest";

import { fetchAbstract } from "./proquest.js";

describe("proquest live helpers", () => {
  it("returns the last known docview snapshot when the abstract session disappears", async () => {
    let abstractPolls = 0;
    const cdp = {
      async send(method: string, params?: Record<string, unknown>) {
        if (method === "Page.navigate") return {};

        const expression = String(params?.expression ?? "");
        if (method === "Runtime.evaluate" && expression === "document.body ? document.body.innerText.length : 0") {
          return { result: { value: 600 } };
        }

        if (method === "Runtime.evaluate") {
          abstractPolls += 1;
          if (abstractPolls === 1) {
            return {
              result: {
                value: {
                  title: "HUMAN NATURE IN POLITICS: A STUDY OF WALTER LIPPMANN",
                  abstract: "",
                },
              },
            };
          }
          throw new Error('{"code":-32001,"message":"Session with given id not found."}');
        }

        throw new Error(`unexpected method: ${method}`);
      },
    };

    await expect(
      fetchAbstract(
        cdp as any,
        "session-1",
        "https://www.proquest.com/docview/301977416/abstract/BB8641D803BB4CA5PQ/12?accountid=14667",
      ),
    ).resolves.toEqual({
      title: "HUMAN NATURE IN POLITICS: A STUDY OF WALTER LIPPMANN",
      abstract: "",
    });
  });
});
