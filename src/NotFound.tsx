export default function NotFound() {
  return (
    <main className="methodology">
      <div className="methodology-inner">
        <header className="methodology-head">
          <h1>Page not found</h1>
        </header>
        <p>That link does not point to a Flockline page or roundup.</p>
        <p>
          <a href="/">Open the bird map</a> or{" "}
          <a href="/roundup">browse the roundup archive</a>.
        </p>
      </div>
    </main>
  );
}
