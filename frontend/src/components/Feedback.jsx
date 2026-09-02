export function Spinner() {
  return (
    <div className="d-flex justify-content-center align-items-center py-5">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">Loading...</span>
      </div>
    </div>
  );
}

export function ErrorAlert({ message }) {
  if (!message) return null;
  return <div className="alert alert-danger py-2">{message}</div>;
}

export function EmptyState({ message = 'No records found.' }) {
  return <div className="text-center text-body-secondary py-5">{message}</div>;
}

export function extractErrorMessage(err) {
  return err?.response?.data?.error || err?.message || 'Something went wrong';
}
