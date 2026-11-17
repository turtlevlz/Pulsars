/** Messaging between medic and patient isn't built yet; this keeps its place in the layout. */
export default function MessagesPlaceholder({ name }: { name: string }) {
  return (
    <section className="card medic-messages" aria-labelledby="messages-title">
      <h2 id="messages-title" className="card__title card__title--lg">
        Messages with {name}
      </h2>
      <p className="history__empty">Messaging is coming soon.</p>
    </section>
  );
}
