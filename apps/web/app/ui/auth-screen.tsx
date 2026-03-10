"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { AuthResponse, RegisterPayload, User, WorkspaceMembership } from "@devhttp/shared";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:4000";
const DESKTOP_DOWNLOAD_URL = "https://github.com/MarceloSantosCorrea/dev-http/releases";

type SessionResponse = {
  user: User;
  workspaceId: string;
  workspaces: WorkspaceMembership[];
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Falha na chamada ${path}`);
  }

  return (await response.json()) as T;
}

export function AuthScreen({
  mode,
}: {
  mode: "login" | "register";
}) {
  const router = useRouter();
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [form, setForm] = useState<RegisterPayload>({
    name: "",
    email: "",
    password: "",
  });

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        await requestJson<SessionResponse>("/auth/me");
        if (!cancelled) {
          router.replace("/");
          return;
        }
      } catch {
        // noop
      } finally {
        if (!cancelled) {
          setIsSessionLoading(false);
        }
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit() {
    try {
      setIsSubmitting(true);
      setFeedback("");

      if (mode === "login") {
        await requestJson<AuthResponse>("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: form.email.trim(),
            password: form.password,
          }),
        });
      } else {
        await requestJson<AuthResponse>("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password,
          }),
        });
      }

      router.replace("/");
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao autenticar.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSessionLoading) {
    return (
      <main className="min-h-screen grid place-items-center p-8">
        <Card className="w-full max-w-lg backdrop-blur-xl">
          <CardHeader>
            <p className="text-[0.7rem] uppercase tracking-widest text-primary font-semibold">
              DevHttp
            </p>
            <CardTitle className="text-2xl font-bold">Restaurando sessão</CardTitle>
            <CardDescription>
              Validando cookies de sessão e preparando o acesso.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center p-8">
      <Card className="w-full max-w-lg backdrop-blur-xl">
        <CardHeader className="items-center text-center gap-2">
          <p className="text-4xl font-bold tracking-tight text-primary">DevHttp</p>
          <CardTitle className="text-2xl font-bold">
            {mode === "login" ? "Fazer login" : "Criar conta"}
          </CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Entre para acessar seus workspaces, projetos, requests e notificações."
              : "Crie sua conta para começar com um workspace próprio chamado Geral."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {mode === "register" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            />
          </div>

          <Button onClick={handleSubmit} disabled={isSubmitting} size="lg" className="w-full mt-1">
            {isSubmitting
              ? mode === "login"
                ? "Entrando..."
                : "Criando conta..."
              : mode === "login"
                ? "Acessar"
                : "Criar conta"}
          </Button>

          <a
            href={DESKTOP_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}
          >
            <ExternalLink className="size-4" />
            Baixar app para desktop
          </a>

          <p className="text-sm text-center text-muted-foreground">
            {mode === "login" ? "Ainda não tem conta?" : "Já possui uma conta?"}{" "}
            <Link
              href={mode === "login" ? "/cadastro" : "/login"}
              className="font-medium text-primary hover:underline"
            >
              {mode === "login" ? "Criar conta" : "Fazer login"}
            </Link>
          </p>

          {feedback ? <p className="text-sm text-destructive">{feedback}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
