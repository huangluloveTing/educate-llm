import request from "supertest";
import { describe, it } from "vitest";

import app from "../src/app.js";

describe("GET /api/v1/health", () => {
  it("responds with ok=true", () =>
    request(app)
      .get("/api/v1/health")
      .set("Accept", "application/json")
      .expect("Content-Type", /json/)
      .expect(200, {
        ok: true,
      }));
});
