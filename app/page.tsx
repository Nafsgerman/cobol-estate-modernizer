export default function Page() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border bg-card px-6 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <circle cx="5" cy="6" r="2" />
            <circle cx="19" cy="6" r="2" />
            <circle cx="12" cy="18" r="2" />
            <path d="M5 8v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
            <path d="M12 12v4" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold tracking-tight">
          COBOL Estate Analyzer
        </h1>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-6 lg:flex-row">
        <section
          aria-label="Dependency Graph"
          className="flex min-h-[480px] flex-1 flex-col rounded-lg border border-border bg-card"
        >
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-medium text-foreground">
              Dependency Graph
            </h2>
          </div>
          <div className="flex flex-1 items-center justify-center bg-muted/40 p-6">
            <p className="text-sm text-muted-foreground">
              Force-directed graph will render here.
            </p>
          </div>
        </section>

        <aside
          aria-label="Program Details"
          className="flex w-full flex-col rounded-lg border border-border bg-card lg:w-80"
        >
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-medium text-foreground">
              Program Details
            </h2>
          </div>
          <div className="flex flex-1 items-center justify-center bg-muted/40 p-6">
            <p className="text-sm text-muted-foreground">
              Select a program to view details.
            </p>
          </div>
        </aside>
      </main>
    </div>
  )
}
