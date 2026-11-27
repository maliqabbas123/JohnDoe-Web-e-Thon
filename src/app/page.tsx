// The backend has no user interface of its own. This page only confirms the
// service is running and points to the API.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl font-semibold">Secure Examination Management System</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Backend API. Endpoints are served under <code>/api/v1</code>.
      </p>
      <p>
        <a className="underline" href="/api/v1/health">
          Service status
        </a>
      </p>
    </main>
  );
}
