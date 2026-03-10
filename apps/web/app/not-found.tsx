export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center p-8">
      <div className="text-center grid gap-3">
        <p className="text-[0.7rem] uppercase tracking-widest text-primary font-semibold">
          DevHttp
        </p>
        <h1 className="text-3xl font-bold">Pagina nao encontrada</h1>
        <p className="text-sm text-muted-foreground">
          O recurso solicitado nao existe ou foi removido.
        </p>
      </div>
    </main>
  );
}
