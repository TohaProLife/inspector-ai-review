import { apiSchemas, buildOpenApiPaths } from "./api-contract.js";

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Инспектор ИИ API",
    version: "0.1.0",
    description: "API вертикального MVP проверки ПД, РД и ИД.",
  },
  servers: [{ url: "http://localhost:4100/api" }],
  paths: buildOpenApiPaths(),
  components: {
    schemas: apiSchemas,
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "inspector_session",
      },
      workerToken: {
        type: "apiKey",
        in: "header",
        name: "X-Worker-Token",
      },
    },
  },
} as const;
