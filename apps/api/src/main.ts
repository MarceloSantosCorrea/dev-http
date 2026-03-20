import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { config } from "dotenv";
import { json, urlencoded } from "express";
import { resolve } from "node:path";

import { AppModule } from "./app.module";
import { getClientInstanceId } from "./auth/auth-http";
import { getAllowedOrigins, isOriginAllowed, parseConfiguredOrigins } from "./http-config";
import { runWithRequestContext } from "./request-context";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../../.env"), override: false });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((request: any, _response: any, next: any) => {
    runWithRequestContext(
      {
        originInstanceId: getClientInstanceId(request),
      },
      next,
    );
  });
  app.use(json({ limit: "10mb" }));
  app.use(urlencoded({ extended: true, limit: "10mb" }));
  const allowedOrigins = parseConfiguredOrigins();
  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin não permitida: ${origin}`), false);
    },
    credentials: true,
    allowedHeaders: ["content-type", "authorization", "x-csrf-token", "x-devhttp-client", "x-devhttp-client-instance"],
    methods: ["GET", "HEAD", "OPTIONS", "POST", "PATCH", "DELETE"],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
}

void bootstrap();
