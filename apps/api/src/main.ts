import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { config } from "dotenv";
import { json, urlencoded } from "express";
import { resolve } from "node:path";

import { AppModule } from "./app.module";
import { getAllowedOrigins } from "./http-config";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../../.env"), override: false });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: "10mb" }));
  app.use(urlencoded({ extended: true, limit: "10mb" }));
  const allowedOrigins = getAllowedOrigins();
  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin não permitida: ${origin}`), false);
    },
    credentials: true,
    allowedHeaders: ["content-type", "authorization", "x-csrf-token", "x-devhttp-client"],
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
