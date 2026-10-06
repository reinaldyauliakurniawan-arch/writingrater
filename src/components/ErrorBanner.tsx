export default function ErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div role="alert" className="banner-error">
      {message}
    </div>
  );
}
