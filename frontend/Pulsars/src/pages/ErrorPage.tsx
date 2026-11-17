import "../styles/Pulsars.css";

const ErrorPage = () => {
  return (
    <main className="auth">
      <div className="auth__card error-page">
        <h1 className="error-page__code">404</h1>
        <p className="error-page__title">Page not found</p>
        <p className="error-page__hint">
          The page you’re looking for doesn’t exist or has been moved.
        </p>
        <a href="/" className="btn btn--primary">
          Go back home
        </a>
      </div>
    </main>
  );
};

export default ErrorPage;
