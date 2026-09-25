export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      {/* The same red margin line as inside the app. */}
      <div aria-hidden className="pointer-events-none fixed inset-y-0 left-6 w-[1.5px] bg-margin sm:left-16" />
      {children}
    </main>
  );
}
