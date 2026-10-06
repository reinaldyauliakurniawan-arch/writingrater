import Header from "./Header";

export default function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-[720px] px-4 py-6">{children}</main>
    </>
  );
}
